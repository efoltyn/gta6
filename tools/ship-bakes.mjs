#!/usr/bin/env node
/* tools/ship-bakes.mjs — THE DEFAULT WORLD'S TERRAIN, BAKED ONCE INTO THE REPO.

   core/bakecache.js keeps Gang City's terrain records (the continent plate,
   the backcountry's tree plan, the Mercy ranges, the snow belts, the far
   backdrop, the city ground detail, the beach) in IndexedDB, so a SECOND visit
   skips building them. A FIRST visit had nothing there and paid the whole
   build: ~9 s of the phone profile's boot. The default world (seed 90210, no
   ?cfg_ flags) is the same for every player of a device class, so this tool
   boots it headless once per device class, reads the records back out of
   IndexedDB and writes them into assets/bakes/, which the boot fetches and
   serves through the SAME key check (a record is used only when its
   signature equals the one the builder computes there and then; anything
   else builds as before).

     node tools/ship-bakes.mjs                    phone + tablet (default)
     node tools/ship-bakes.mjs --devices phone    one class (phone|tablet|desktop)
     node tools/ship-bakes.mjs --check            no browser, a second: do the
                                                  terrain scripts' ?v= tags in
                                                  index.html still match the
                                                  shipped files? (exit 1 if not)
     node tools/ship-bakes.mjs --verify [--cpu 4] boot the phone profile with
                                                  ?bake=verify: every shipped
                                                  record is compared byte for
                                                  byte with a fresh build, and a
                                                  record the build no longer
                                                  asks for is named STALE (its
                                                  inputs moved: a builder that
                                                  runs before it changed what
                                                  it registers, which no ?v=
                                                  check can see). Run it, or
                                                  just regenerate, before a
                                                  release.

   WHEN TO RE-RUN: whenever a script that shapes terrain changes its ?v= (the
   list is core/bakecache.js's TERRAIN_FILES), or the world plan, the seed or a
   CONFIG default changes. A stale file is never wrong, only useless: every
   record misses and the world builds (and a returning player stops
   downloading it, see STALE_KEY in core/bakecache.js). `--check` says so.

   OUTPUT (assets/bakes/):
     city-<device>.json             the manifest the boot reads first (KB)
     city-<id>.bin.gz               the records, gzip; named by content, so
                                    phone and tablet share one file when their
                                    records are identical, and a cached old
                                    file can never pair with a new manifest
   The binary: "CBZB", u32 version, u32 header length, header JSON, then each
   array at an 8-byte aligned offset, multi-byte arrays BYTE-SHUFFLED (all
   byte 0s, then all byte 1s, ...: the same bytes, ~30% smaller under gzip).
   What ships is decided by what a record saves on the phone profile (4x
   CPU, cold boot, compute between its bakeGet and bakePut) against what it
   adds to the download (gzip), measured 2026-11-22:
     continent-plate    2.5 s   2.3 MB      greater-range   2.1 s   1.3 MB
     continent-trees   ~2.0 s   1.2 MB      terrain-backdrop 1.6 s  0.3 MB
     mount-mercy        0.9 s   0.5 MB      greater/mercy-axes 0.6 s  ~0
     snow-belt-*        0.1 s   0.2 MB
   NOT shipped:
     city-ground-detail 0.3 s for 2.4 MB (noise textures: gzip cannot shrink
                        them); city-beach 0.14 s for 0.5 MB: a download that
                        costs more than the build it saves on a phone network
     desert-erg-rec / desert-erg  the erg is built per tile on approach, not
                        at boot (the record is not even written)
     continent-plate.fn normals: recomputed in ~0.3 s, 2.8 MB raw
   Files are written atomically (temp + rename); bins no manifest names are
   removed. */
import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { gzipSync, constants as Z } from "node:zlib";
import { createHash } from "node:crypto";
import { launch, ROOT } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const OUT = path.join(ROOT, "assets/bakes");
const mb = (n) => (n / 1048576).toFixed(2) + " MB";

// which records ship, and which of their arrays are left out
const SHIP = [/^continent-plate$/, /^continent-trees$/, /^mercy-axes$/, /^mount-mercy$/,
  /^greater-axes$/, /^greater-range$/, /^snow-belt-\d+$/, /^terrain-backdrop$/];
const DROP = { "continent-plate": ["fn"] };

const UA = {
  phone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  tablet: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};
const DEV = {
  phone: { window: "390,844", metrics: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true } },
  tablet: { window: "820,1180", metrics: { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true } },
  desktop: { window: "1280,800", metrics: null },
};

/* ---- the key's static half: what core/bakecache.js's bakeSig() puts before
   "||" for index.html (seed + every terrain script's src), read off the two
   files themselves so there is one list, in bakecache.js */
function staticBase() {
  const bc = readFileSync(path.join(ROOT, "src/core/bakecache.js"), "utf8");
  const m = bc.match(/const TERRAIN_FILES = (\/.*\/);/);
  if (!m) throw new Error("TERRAIN_FILES not found in src/core/bakecache.js");
  const re = new Function("return " + m[1])();
  const html = readFileSync(path.join(ROOT, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  let s = "seed:90210";
  for (const t of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) if (re.test(t[1])) s += "|" + t[1].replace(/^.*\/src\//, "");
  return s;
}

function check() {
  const base = staticBase();
  const mans = existsSync(OUT) ? readdirSync(OUT).filter((f) => /^city-[a-z]+\.json$/.test(f)) : [];
  if (!mans.length) { console.log("no shipped bakes in " + OUT); return 1; }
  let stale = 0;
  for (const f of mans) {
    const man = JSON.parse(readFileSync(path.join(OUT, f), "utf8"));
    if (!man.file) { console.log("none    " + f + " (no shipped bakes for this class)"); continue; }
    const ok = man.base === base && existsSync(path.join(OUT, man.file));
    if (!ok) stale++;
    console.log((ok ? "current " : "STALE   ") + f + " -> " + man.file + " (" + mb(man.gz) + " gz, " + mb(man.raw) + " raw, " + man.entries.length + " records, made " + man.made + ")");
    if (!ok && man.base !== base) {
      const a = man.base.split("|"), b = base.split("|");
      for (const x of b) if (!a.includes(x)) console.log("    now:     " + x);
      for (const x of a) if (!b.includes(x)) console.log("    shipped: " + x);
    }
  }
  if (stale) console.log("re-run: node tools/ship-bakes.mjs");
  return stale ? 1 : 0;
}

async function emulate(rig, dev) {
  const d = DEV[dev];
  if (d.metrics) await rig.send("Emulation.setDeviceMetricsOverride", d.metrics);
  if (dev !== "desktop") {
    await rig.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await rig.send("Emulation.setUserAgentOverride", { userAgent: UA[dev], platform: dev === "phone" ? "iPhone" : "iPad" });
  }
}

const PLAY = `(() => { if (CBZ.game.state === 'playing' && CBZ.game.mode === 'city') return true;
  if (CBZ.game.state === 'title' && (!window.__clk || performance.now() - window.__clk > 2500)) { window.__clk = performance.now();
    const pb = document.getElementById('playBtn'); if (pb) pb.click(); } return false; })()`;

async function bootCity(rig, query) {
  await rig.open("index.html", query);
  await new Promise((r) => setTimeout(r, 1500));
  if (!await rig.wait("document.readyState==='complete' && window.CBZ && CBZ.game && CBZ.startRun", 300000, 250)) throw new Error("page never finished loading");
  if (!await rig.wait(PLAY, 900000, 500)) throw new Error("city never started");
  await rig.wait("!(CBZ.bootMeter && CBZ.bootMeter.active())", 300000, 300);
}

async function generate(dev) {
  const t0 = Date.now();
  const rig = await launch({ rafBudget: 0, gpu: "real", window: DEV[dev].window });
  const quit = async () => { try { await rig.close(); } finally { process.exit(1); } };
  for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, quit);
  try {
    await emulate(rig, dev);
    // the DEFAULT world: no seed, no cfg_ flags; ?bake=fresh = IndexedDB only
    // (never serve the shipped file being replaced)
    await bootCity(rig, "mode=city&bake=fresh");
    // every put lands (the deferred ones wait 3 s), then nothing more comes
    let last = -1, still = 0;
    for (let i = 0; i < 60 && still < 4; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const p = await rig.evl("CBZ.bakeStats.puts");
      still = p === last ? still + 1 : 0; last = p;
    }
    await new Promise((r) => setTimeout(r, 4000));
    const info = await rig.evl(`(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open("cbz-bake", 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const recs = await new Promise((res, rej) => { const out = []; const c = db.transaction("bake").objectStore("bake").openCursor();
        c.onsuccess = () => { const k = c.result; if (!k) { res(out); return; } out.push([k.key, k.value]); k.continue(); }; c.onerror = () => rej(c.error); });
      window.__shipRecs = new Map(recs);
      const base = CBZ.bakeSig("").slice(0, -2);
      // CONFIG as the builders hash it, flattened one level (to name what differs between device classes)
      const cfg = {}; for (const k in CBZ.CONFIG) if (k.charCodeAt(0) !== 95) { try { cfg[k] = JSON.stringify(CBZ.CONFIG[k]); } catch (e) { cfg[k] = "?"; } }
      return { base, cfg, seed: CBZ.WORLD_SEED, device: CBZ.deviceClass, log: CBZ.bakeStats.log, errors: CBZ.bakeStats.err,
        recs: recs.map(([k, v]) => ({ key: k, sig: v.sig, arrays: Object.keys(v.arrays).map((n) => ({ name: n, type: v.arrays[n].constructor.name, length: v.arrays[n].length, bytes: v.arrays[n].byteLength })) })) };
    })()`, true);
    if (info.device !== dev) throw new Error("the page booted as " + info.device + ", not " + dev);
    const entries = [];
    for (const r of info.recs) {
      if (!SHIP.some((re) => re.test(r.key))) { console.log("  not shipped: " + r.key); continue; }
      const drop = DROP[r.key] || [];
      const arrays = [];
      for (const a of r.arrays) {
        if (drop.includes(a.name)) continue;
        // the bytes, base64, in 3 MB slices
        const parts = [];
        for (let off = 0; off < a.bytes; off += 3 << 20) {
          parts.push(Buffer.from(await rig.evl(`(() => { const t = window.__shipRecs.get(${JSON.stringify(r.key)}).arrays[${JSON.stringify(a.name)}];
            const u = new Uint8Array(t.buffer, t.byteOffset, t.byteLength).subarray(${off}, ${off} + (3 << 20)); let s = "";
            for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); })()`), "base64"));
        }
        const buf = Buffer.concat(parts);
        if (buf.length !== a.bytes) throw new Error("short read " + r.key + "." + a.name);
        arrays.push({ ...a, buf });
      }
      entries.push({ key: r.key, sig: r.sig, arrays });
    }
    const errs = rig.errors.slice(0, 8);
    return { dev, info, entries, errs, sec: (Date.now() - t0) / 1000 };
  } finally { await rig.close(); }
}

function bpe(type) { return { Float64Array: 8, Float32Array: 4, Uint32Array: 4, Int32Array: 4, Uint16Array: 2, Int16Array: 2, Uint8Array: 1, Int8Array: 1 }[type]; }
function shuffle(buf, size) {
  if (size < 2) return buf;
  const n = buf.length / size, out = Buffer.allocUnsafe(buf.length);
  for (let b = 0; b < size; b++) { const o = b * n; for (let i = 0; i < n; i++) out[o + i] = buf[i * size + b]; }
  return out;
}
function pack(entries) {
  const head = { v: 1, entries: [] };
  const chunks = [];
  let off = 0;
  for (const e of entries) {
    const he = { key: e.key, sig: e.sig, arrays: [] };
    for (const a of e.arrays) {
      // shuffled where that packs tighter (smooth floats), as-is where not
      // (the tree plan's scattered positions)
      const size = bpe(a.type);
      let data = a.buf, sh = 0;
      if (size > 1 && a.buf.length > 64) {
        const s = shuffle(a.buf, size);
        if (gzipSync(s, { level: 6 }).length < gzipSync(a.buf, { level: 6 }).length) { data = s; sh = size; }
      }
      he.arrays.push({ name: a.name, type: a.type, length: a.length, offset: off, shuffle: sh });
      chunks.push(data);
      const pad = (8 - (data.length & 7)) & 7;
      if (pad) chunks.push(Buffer.alloc(pad));
      off += data.length + pad;
    }
    head.entries.push(he);
  }
  const hj = Buffer.from(JSON.stringify(head), "utf8");
  const pre = Buffer.alloc(12);
  pre.write("CBZB", 0, "latin1"); pre.writeUInt32LE(1, 4); pre.writeUInt32LE(hj.length, 8);
  const hpad = (8 - ((12 + hj.length) & 7)) & 7;
  return Buffer.concat([pre, hj, Buffer.alloc(hpad), ...chunks]);
}
function atomicWrite(file, data) {
  const tmp = path.join(path.dirname(file), "." + path.basename(file) + ".tmp");
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

async function verify() {
  const cpu = +arg("--cpu", 1);
  const rig = await launch({ rafBudget: 0, gpu: "real", window: DEV.phone.window });
  try {
    await emulate(rig, "phone");
    if (cpu > 1) await rig.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    await bootCity(rig, "mode=city&bake=verify");
    await new Promise((r) => setTimeout(r, 2000));
    const v = await rig.evl("({ verified: CBZ.bakeStats.verified || 0, mismatch: CBZ.bakeStats.mismatch || 0, ship: CBZ.bakeStats.ship, log: CBZ.bakeStats.log })");
    // a shipped record whose key the build no longer computes is STALE: its
    // inputs moved (a builder before it changed what it registers) without a
    // terrain script's ?v= changing, which --check cannot see
    const man = JSON.parse(readFileSync(path.join(OUT, "city-phone.json"), "utf8"));
    v.stale = man.entries.map((e) => e.key).filter((k) => !v.log.includes("verify shipped " + k));
    console.log(JSON.stringify(v, null, 1));
    console.log("errors:", rig.errors.slice(0, 8));
    if (v.stale.length) console.log("STALE (re-run node tools/ship-bakes.mjs): " + v.stale.join(", "));
    return v.mismatch || v.stale.length ? 1 : 0;
  } finally { await rig.close(); }
}

async function main() {
  if (has("--check")) return check();
  if (has("--verify")) return verify();
  const devices = String(arg("--devices", "phone,tablet")).split(",").map((s) => s.trim()).filter(Boolean);
  for (const d of devices) if (!DEV[d]) throw new Error("unknown device " + d);
  const base = staticBase();
  mkdirSync(OUT, { recursive: true });
  const written = new Map();          // bin name -> bytes
  const cfgs = {};
  for (const dev of devices) {
    console.log("== " + dev + ": booting the default world headless ...");
    const r = await generate(dev);
    cfgs[dev] = r.info.cfg;
    if (r.errs.length) console.log("  page errors:", r.errs);
    if (r.info.base !== base) throw new Error(dev + ": the page's key base differs from index.html's (" + r.info.base.length + " vs " + base.length + " chars): is the tree being edited?");
    r.entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const bin = pack(r.entries);
    const gz = gzipSync(bin, { level: 9, memLevel: 9 });
    const id = createHash("sha256").update(bin).digest("hex").slice(0, 12);
    const file = "city-" + id + ".bin.gz";
    if (!written.has(file)) { atomicWrite(path.join(OUT, file), gz); written.set(file, gz.length); }
    const man = { v: 1, id, made: new Date().toISOString(), device: dev, seed: r.info.seed >>> 0, base, file, raw: bin.length, gz: gz.length,
      entries: r.entries.map((e) => ({ key: e.key, sig: e.sig, bytes: e.arrays.reduce((s, a) => s + a.bytes, 0) })) };
    atomicWrite(path.join(OUT, "city-" + dev + ".json"), JSON.stringify(man, null, 1) + "\n");
    console.log("  " + dev + ": " + file + "  raw " + mb(bin.length) + "  gzip " + mb(gz.length) + "  (" + r.sec.toFixed(0) + " s)");
    for (const e of r.entries) {
      const raw = Buffer.concat(e.arrays.map((a) => a.buf)), sh = Buffer.concat(e.arrays.map((a) => shuffle(a.buf, bpe(a.type))));
      console.log("    " + e.key.padEnd(20) + " raw " + mb(raw.length).padStart(9) + "  gzip " + mb(gzipSync(raw, { level: 9 }).length).padStart(9) + "  shuffled+gzip " + mb(gzipSync(sh, { level: 9 }).length).padStart(9));
    }
    console.log("  bake log: " + r.info.log.join(", "));
  }
  // which CONFIG keys differ between the classes (each one splits the keys)
  const ds = Object.keys(cfgs);
  for (let i = 1; i < ds.length; i++) {
    const a = cfgs[ds[0]], b = cfgs[ds[i]], diff = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) diff.push(k + " " + a[k] + " / " + b[k]);
    console.log("  CONFIG " + ds[0] + " vs " + ds[i] + ": " + (diff.length ? diff.join("; ") : "identical"));
  }
  // a class with no file of its own gets a manifest that says so: its boot
  // reads a few bytes instead of logging a 404 on every city start
  for (const d of Object.keys(DEV)) {
    const f = path.join(OUT, "city-" + d + ".json");
    if (!devices.includes(d) && !existsSync(f)) {
      atomicWrite(f, JSON.stringify({ v: 1, id: "none", made: new Date().toISOString(), device: d, base, file: null, raw: 0, gz: 0, entries: [] }, null, 1) + "\n");
      console.log("  " + d + ": no shipped bakes (stub manifest)");
    }
  }
  // bins no manifest names any more
  const named = new Set(readdirSync(OUT).filter((f) => /^city-[a-z]+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(path.join(OUT, f), "utf8")).file));
  for (const f of readdirSync(OUT)) if (/^city-[0-9a-f]+\.bin\.gz$/.test(f) && !named.has(f)) { unlinkSync(path.join(OUT, f)); console.log("  removed " + f); }
  return 0;
}

main().then((code) => process.exit(code || 0), (e) => { console.error(e && e.stack || e); process.exit(1); });
