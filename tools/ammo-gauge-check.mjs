#!/usr/bin/env node
/* tools/ammo-gauge-check.mjs — THE ONE AMMO GAUGE, IN PLAIN NODE.

   Lifts systems/fpsmode.js's THE AMMO GAUGE block (CSS + agRender +
   setAmmoHud) out of the file as written and runs it against a tiny fake DOM
   and a fake fps store, then holds it to what it promises:
     · no words: the gauge's text is digits (and the homing glyph) only
     · one pip per round up to PIP_MAX, a bar past it; lit pips = the rounds
     · firing drains a pip; the last quarter is LOW, nothing left is DRY
     · a reload fills the pips back in on the animation's clock (grab ->
       seat), never ahead of it, monotonic, and lands on the full magazine
       with the reserve paid out of the small numeral
     · hidden with no gun, a melee weapon, dead, or behind the wheel
     · placed bottom-right on desktop, centred over the hotbar on touch
     · the city draws no second ammo line (#cAmmo gone from city/hud.js)

     node tools/ammo-gauge-check.mjs        exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const src = read("src/systems/fpsmode.js");
const a = src.indexOf("  const PIP_MAX = 40;");
const b = src.indexOf("    setWeaponStrip();\n  }", a);
let fails = 0;
function check(name, ok, detail) { console.log((ok ? "ok   " : "FAIL ") + name + (detail ? "  " + detail : "")); if (!ok) fails++; }
if (a < 0 || b < 0) { console.log("FAIL: THE AMMO GAUGE block not found in systems/fpsmode.js"); process.exit(1); }
const block = src.slice(a, b) + "    setWeaponStrip();\n  }\n";

// ---- a fake DOM just deep enough for the gauge ----
function El(tag) {
  const e = {
    tagName: tag, children: [], style: { setProperty(k, v) { this[k] = v; } }, hidden: false, src: "", alt: "",
    _cls: [], _text: "",
    get className() { return this._cls.join(" "); },
    set className(v) { this._cls = String(v).split(/\s+/).filter(Boolean); },
    classList: null,
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    set textContent(v) { this.children = []; this._text = String(v); },
    isConnected: true,
  };
  e.classList = {
    add: (c) => { if (!e._cls.includes(c)) e._cls.push(c); },
    remove: (c) => { e._cls = e._cls.filter((x) => x !== c); },
    toggle: (c, on) => { const has = e._cls.includes(c); const want = on == null ? !has : !!on; if (want && !has) e._cls.push(c); if (!want && has) e._cls = e._cls.filter((x) => x !== c); return want; },
    contains: (c) => e._cls.includes(c),
  };
  return e;
}
const head = El("head"), body = El("body"), ammoEl = El("div");
const document = {
  head, body,
  createElement: (t) => El(t),
  getElementById: (id) => id === "ammo" ? ammoEl : (head.children.find((c) => c.id === id) || null),
};

const WEAPONS = [
  { key: "pistol", id: "sidearm", mag: 12, reload: 1.2 },
  { key: "shotgun", id: "shotgun", mag: 6, reload: 0.5, shellReload: true },
  { key: "lmg", id: "lmg", mag: 100, reload: 3 },
  { key: "shank", id: "shank", mag: 0, melee: true },
];
const fps = { active: true, weapon: 0, rounds: [12, 6, 100, 0], reserves: [36, 12, 200, 0], ammo: 0, mag: 0, reserve: 0, reloading: 0 };
const ctx = vm.createContext({
  document, Math, String, Number,
  CBZ: { game: { mode: "escape", state: "playing" }, player: { dead: false, driving: false },
    gunReload: { recipe: () => ({ grab: 0.5, seat: 0.82 }) }, itemIconGun: (id) => "data:image/png;base64,GUN-" + id },
  fps, WEAPONS, weaponModels: [{}, {}, {}, {}], state: { reloadWeapon: 0, armed: true },
});
vm.runInContext(`
  function ammoHudEl() { return document.getElementById("ammo"); }
  function syncAmmo() { fps.ammo = fps.rounds[fps.weapon]; fps.mag = WEAPONS[fps.weapon].mag; fps.reserve = fps.reserves[fps.weapon]; }
  function weapon() { return WEAPONS[fps.weapon]; }
  function weaponIdOf(i) { return WEAPONS[i].id; }
  function rocketAmmoSpec() { return null; }
  function shoulderActive() { return false; }
  function carGun() { return false; }
  function armed() { return state.armed; }
  function setWeaponStrip() {}
  var reloadWeapon = 0;
  ${block}
  this.setAmmoHud = setAmmoHud;
  this.setReloadWeapon = function (i) { reloadWeapon = i; };
`, ctx);
const { setAmmoHud, setReloadWeapon } = ctx;

const G = () => ammoEl._ag;
const pips = () => G().pipEls;
const lit = () => pips().filter((p) => p._cls.includes("on")).length;
const has = (c) => ammoEl._cls.includes(c);
const shown = () => ammoEl.style.display === "flex";

// ---- rest state ----
setAmmoHud();
const css = (document.getElementById("ammoGaugeStyle") || {})._text || "";
check("gauge shows with a gun out", shown());
check("one pip per round", pips().length === 12 && lit() === 12, pips().length + " pips, " + lit() + " lit");
check("big magazine numeral + small reserve", G().mag.textContent === "12" && G().res.textContent === "36");
check("no words in the gauge", !/[A-Za-z]/.test(ammoEl.textContent), JSON.stringify(ammoEl.textContent));
check("the held gun's silhouette (hotbar render)", !G().gun.hidden && /GUN-sidearm/.test(G().gun.src));
check("desktop: bottom-right", /#ammo\.ag\{position:fixed;left:auto;top:auto;right:calc\(24px/.test(css) && /bottom:calc\(22px/.test(css));
check("touch: centred over the hotbar", /body\.touch #ammo\.ag\{right:auto;left:50%;transform:translateX\(-50%\)/.test(css) && /bottom:calc\(84px/.test(css));
check("low ammo breathes, and honours reduced motion", /#ammo\.ag\.low \.agMag,#ammo\.ag\.dry \.agMag\{animation:agBreath/.test(css) && /prefers-reduced-motion/.test(css));

// ---- fire down to low, then dry ----
let drained = true;
for (let n = 11; n >= 0; n--) {
  fps.rounds[0] = n; setAmmoHud();
  if (lit() !== n || G().mag.textContent !== String(n)) drained = false;
  if (n === 4) check("not low at 4 / 12", !has("low"));
  if (n === 3) check("LOW at the last quarter (3 / 12)", has("low") && !has("dry"));
}
check("each round fired drains one pip", drained);
check("DRY at zero", has("dry") && !has("low"));

// ---- reload: pips fill grab -> seat ----
setReloadWeapon(0);
const steps = [];
for (let p = 0; p <= 1.0001; p += 0.05) {
  fps.reloading = Math.max(1e-4, 1.2 * (1 - p));
  setAmmoHud();
  steps.push({ p, n: +G().mag.textContent, lit: lit(), res: +G().res.textContent, rl: has("rl") });
}
const before = steps.filter((s) => s.p < 0.5 - 1e-6), after = steps.filter((s) => s.p > 0.82 + 1e-6);
check("reload state while reloading", steps.every((s) => s.rl));
check("nothing fills before the fresh mag is in the hand", before.every((s) => s.n === 0 && s.lit === 0), before.map((s) => s.n).join(","));
check("full by the time it seats", after.every((s) => s.n === 12 && s.lit === 12), after.map((s) => s.n).join(","));
check("fills monotonic, pips with the numeral", steps.every((s, i) => i === 0 || (s.n >= steps[i - 1].n && s.lit === s.n)));
check("reserve pays out as it fills", steps.every((s) => s.res + s.n === 36));
fps.reloading = 0; fps.rounds[0] = 12; fps.reserves[0] = 24; setAmmoHud();
check("reload over: plain state", !has("rl") && !has("dry") && !has("low") && G().mag.textContent === "12" && G().res.textContent === "24");

// ---- a shell gun fills one shell per cycle; a belt is a bar ----
fps.weapon = 1; fps.rounds[1] = 2; setReloadWeapon(1); fps.reloading = 0.5 * (1 - 0.66); setAmmoHud();
check("shotgun: fat pips, one per shell", pips().length === 6);
check("shell reload: the next shell fills partway", G().mag.textContent === "2" && pips().some((p) => p._cls.includes("nx")));
fps.reloading = 0; fps.weapon = 2; fps.rounds[2] = 50; setAmmoHud();
check("past PIP_MAX: one bar that drains", pips().length === 0 && G().fill && /scaleX\(0\.5\)/.test(G().fill.style.transform));

// ---- hidden ----
fps.weapon = 3; setAmmoHud();
check("melee: no gauge", !shown());
fps.weapon = 0; setAmmoHud(); check("back to a gun: shown", shown());
ctx.state.armed = false; setAmmoHud(); check("no gun: no gauge", !shown()); ctx.state.armed = true;
ctx.CBZ.player.dead = true; setAmmoHud(); check("dead: no gauge", !shown()); ctx.CBZ.player.dead = false;
ctx.CBZ.player.driving = true; setAmmoHud(); check("behind the wheel: no gauge", !shown()); ctx.CBZ.player.driving = false;

// ---- one renderer ----
const hud = read("src/city/hud.js");
check("the city draws no second ammo line", !/id='cAmmo'|ammoReadout\(/.test(hud));

console.log(fails ? "\n" + fails + " FAIL" : "\nammo-gauge-check: all ok");
process.exit(fails ? 1 : 0);
