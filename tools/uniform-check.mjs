#!/usr/bin/env node
/* tools/uniform-check.mjs — uniformed roles wear ONE uniform, in plain node.

   Owner: "The President's security wear different coloured suits; they
   should wear black suits." The detail wore CAT.suit, a record with no suit
   STYLE, so clothes.js picked SUIT_STYLES[rig.id % n] per body (tan, powder
   blue, all-white...). This loads the REAL city/clothes.js + city/outfits.js
   into a vm and asserts:

     1. every protective-detail job (secret service, close protection,
        bodyguard, hired security, the motorcade/mansion/power.js/vips.js/
        millionaires.js strings) casts the ONE detail record: a pinned
        "Detail Black" suit style — near-black jacket and trousers, a dark tie
        — the white shirt clothes.js's formal torso always paints, black
        shoes, shades + earpiece kit;
     2. dressing two bodies with DIFFERENT rng/seed/sex gives the same record
        and the same painted key for every uniformed role;
     3. guards / wardens / police / SWAT / soldiers / counter-snipers / each
        gang map to one record each, whatever the job spelling;
     4. recolorRig actually mounts the kit (7 meshes on the neck) on a detail
        body, strips it on a re-dress into anything else, and paints gloves on
        a gloved uniform then walks the hands back to skin.

     node tools/uniform-check.mjs
*/
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console, Math });
ctx.window = ctx; ctx.self = ctx;
// the smallest DOM the two files touch at load (canvas only when painting,
// and painting is stubbed below)
ctx.document = {
  createElement() { return { getContext() { return null; }, style: {}, appendChild() {}, addEventListener() {} }; },
  getElementById() { return null; }, addEventListener() {}, body: { appendChild() {} },
  getElementsByTagName() { return []; }, querySelector() { return null; },
};
ctx.addEventListener = () => {};
ctx.location = { search: "" };
ctx.CBZ = {
  CONFIG: {}, game: {}, onUpdate() {}, onAlways() {}, on() {}, emit() {},
  CITY: { gangs: [
    { id: "reds", name: "Reds", color: 0xc8302f, accent: 0x1a1111 },
    { id: "blues", name: "Blues", color: 0x2f5fc8, accent: 0x10131a },
  ] },
};
vm.runInContext(read("src/vendor/three.r128.min.js"), ctx, { filename: "three" });
const GEO = {}, MAT = {};
ctx.CBZ.boxGeom = (w, h, d) => GEO[w + "," + h + "," + d] || (GEO[w + "," + h + "," + d] = new ctx.THREE.BoxGeometry(w, h, d));
ctx.CBZ.cmat = (hex) => MAT[hex] || (MAT[hex] = Object.assign(new ctx.THREE.MeshLambertMaterial({ color: hex }), { _shared: true }));
for (const f of ["src/city/clothes.js", "src/city/outfits.js"]) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { console.log("load " + f + " threw: " + e.message); process.exit(2); }
}
const { CBZ, THREE } = ctx;
let fails = 0, checks = 0;
function check(ok, msg) { checks++; if (!ok) { fails++; console.log("  FAIL " + msg); } }

// painter stub: record what the wardrobe asked the atlas for. The painted KEY
// for a suit is "suit|" + style; a record with no style is the random bug.
const painted = [];
CBZ.cityApplyClothes = (ch, rec) => { painted.push(rec); return null; };
CBZ.cityPaintedBodyHex = () => null;

const lum = (h) => (0.2126 * ((h >> 16) & 255) + 0.7152 * ((h >> 8) & 255) + 0.0722 * (h & 255)) / 255;
const cat = CBZ.cityOutfitCatalog();
const styles = CBZ.citySuitStyles;
check(!!cat.detail, "catalog has the detail record");
const D = cat.detail;
check(D.id === "suit" && D.style != null, "detail is a PINNED painted suit (style " + D.style + ")");
const st = styles[D.style] || {};
check(st.name === "Detail Black", "detail style is 'Detail Black' (got " + st.name + ")");
check(lum(st.body) < 0.1 && lum(st.legs != null ? st.legs : st.body) < 0.1, "jacket + trousers near-black");
check(st.tie != null && lum(st.tie) < 0.1, "tie is dark");
check(/shirt = "#f1f2ec"/.test(read("src/city/clothes.js")), "the formal torso paints a white shirt");
check(lum(D.colors.torso) < 0.1 && lum(D.colors.legs) < 0.1 && lum(D.colors.shoes) < 0.1, "flat fallback is black too");
check(lum(D.colors.shirt) > 0.9, "record's shirt is white");
check(D.kit && D.kit.shades && D.kit.earpiece, "detail carries shades + earpiece");

// ---- 1 + 2: every protective job, two different bodies each
const DETAIL_JOBS = ["secret service", "close protection", "bodyguard", "hired security", "protective detail"];
const bodies = [
  { rng: () => 0.03, seed: 11, sex: "m", archetype: "security" },
  { rng: () => 0.97, seed: 90210, sex: "f", archetype: "professional" },
];
function keyOf(rec) { return rec ? (rec.id === "suit" ? "suit|" + rec.style : rec.id) : null; }
for (const job of DETAIL_JOBS) {
  const ks = bodies.map((b) => { const r = CBZ.cityOutfitFor(Object.assign({ job, band: "adult" }, b)); return r; });
  check(ks[0] === D && ks[1] === D, `"${job}" -> the detail record (got ${keyOf(ks[0])} / ${keyOf(ks[1])})`);
}
// ---- 3: one record per uniformed role
const ROLES = [
  ["corrections", ["correctional officer", "prison guard", "corrections officer"]],
  ["warden", ["prison warden", "warden"]],
  ["police", ["police officer", "uniformed division officer", "patrol officer"]],
  ["tactical", ["counter-sniper", "bureau agent"]],
  ["soldier", ["soldier", "military aide"]],
  ["security", ["security guard", "private security"]],
];
for (const [id, jobs] of ROLES) for (const job of jobs) for (const b of bodies) {
  const r = CBZ.cityOutfitFor(Object.assign({ job, band: "adult" }, b));
  check(r === cat[id], `"${job}" (${b.sex}) -> CAT.${id} (got ${r && r.id})`);
}
for (const b of bodies) {
  check(CBZ.cityOutfitFor(Object.assign({ kind: "cop", cop: true, band: "adult" }, b)) === cat.police, "kind cop -> police");
  check(CBZ.cityOutfitFor(Object.assign({ kind: "cop", cop: true, swat: true, band: "adult" }, b)) === cat.swat, "swat -> swat");
  check(CBZ.cityOutfitFor(Object.assign({}, b, { archetype: "security", job: "some unlisted post", band: "adult" })) === cat.security, "security archetype, unknown job -> guard blacks");
  check(CBZ.cityOutfitFor(Object.assign({}, b, { archetype: "military", job: "quartermaster", band: "adult" })) === cat.soldier, "military archetype, unknown job -> fatigues");
  for (const g of ["reds", "blues"]) {
    const r = CBZ.cityOutfitFor(Object.assign({ gang: g, band: "adult" }, b));
    check(r === cat["gang:" + g], `gang ${g} -> its one record`);
  }
}
check(cat["gang:reds"].colors.torso === 0xc8302f && cat["gang:blues"].colors.torso === 0x2f5fc8, "gang records wear the gang colour");
for (const id of ["swat", "soldier", "tactical"]) check(cat[id].colors.gloves != null, `CAT.${id} is gloved`);
check(cat.detail.colors.gloves == null, "the detail is bare-handed");

// ---- 4: recolorRig mounts / strips the kit and the gloves
function mesh() { return { material: { color: { h: null, setHex(x) { this.h = x; } }, emissive: null }, userData: {}, visible: true }; }
function rig() {
  const s = {};
  for (const k of ["pelvis", "legs", "legsLower", "torso", "arms", "armsLower", "collar", "shoes", "cap", "hair", "badge"]) s[k] = [mesh()];
  s.hands = [mesh(), mesh()];
  return { skinSlots: s, neck: new THREE.Group(), profile: { headSize: 0.6 }, skinTone: 0x8d5a3b };
}
const a = rig(), b = rig();
CBZ.cityRecolorRig(a, D.colors, D);
CBZ.cityRecolorRig(b, D.colors, D);
const last2 = painted.slice(-2);
check(last2.length === 2 && keyOf(last2[0]) === keyOf(last2[1]) && last2[0].style === D.style, "two detail bodies ask the atlas for the same suit key");
check(a._detailKit && a._detailKit.children.length === 7 && a._detailKit.parent === a.neck, "kit mounted on the neck (7 parts)");
check(a._detailKit.children[0].geometry === b._detailKit.children[0].geometry && a._detailKit.children[0].material === b._detailKit.children[0].material, "kit geometry/material shared between wearers");
CBZ.cityRecolorRig(a, cat.swat.colors, cat.swat);
check(!a._detailKit && a.neck.children.length === 0, "re-dress into SWAT strips the kit");
const hexOf = (m) => (m.material.color.getHex ? m.material.color.getHex() : m.material.color.h);
check(a.skinSlots.hands.every((m) => hexOf(m) === cat.swat.colors.gloves && m.material === ctx.CBZ.cmat(cat.swat.colors.gloves)), "SWAT paints gloves (the shared glove cmat)");
CBZ.cityRecolorRig(a, cat.street.colors, cat.street);
check(a.skinSlots.hands.every((m) => hexOf(m) === a.skinTone), "back to street: hands are skin again");
const c = rig();
CBZ.cityRecolorRig(c, cat.street.colors, cat.street);
check(c.skinSlots.hands.every((m) => m.material.color.h === null), "a never-gloved body's hands are never touched");

// ---- the source strings: no protective spawner dresses a random suit any more
const prot = read("src/city/protection.js");
check(!/^[^/\n]*dressAs\(/m.test(prot), "protection.js has no dressAs(...\"suit\") override left");
check(/"secret service"/.test(prot) && /"hired security"/.test(prot), "protection.js posts detail jobs the caster maps");

console.log(`uniform-check: ${checks - fails}/${checks} passed`);
process.exit(fails ? 1 : 0);
