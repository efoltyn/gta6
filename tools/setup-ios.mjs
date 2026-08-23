#!/usr/bin/env node
/* tools/setup-ios.mjs — everything `npx cap add ios` leaves for you to do,
   for the NATURAL DISASTER SURVIVAL app.

   This repo ships TWO iOS apps and they must never touch each other's shell:
     · Gang Life (the full game) — repo-root capacitor.config.json, with its
       Xcode project COMMITTED at ios/App. docs/APP-STORE.md is its runbook.
       This tool must never write into it.
     · Natural Disaster Survival — apps/disaster-ios/, whose Xcode project is
       GENERATED on the Mac (cd apps/disaster-ios && npx cap add ios) and is
       gitignored. That generated project is the only thing this tool edits.

   Capacitor generates a working Xcode project and stops there: a default icon,
   a portrait-and-landscape app, a visible status bar, no privacy manifest. This
   tool applies the rest, and it is IDEMPOTENT — run it again after any
   `cap sync`, or after regenerating the project from scratch, and it makes the
   same four changes without duplicating anything.

     node tools/setup-ios.mjs

   1. Info.plist gets the keys in apps/disaster-ios/Info.plist.additions (landscape only on
      iPhone, full screen, no status bar, encryption declared, Metal required).
   2. apps/disaster-ios/PrivacyInfo.xcprivacy is copied in beside it.
   3. The app icon from apps/disaster-ios/art/AppIcon-1024.png becomes the AppIcon set.
   4. The launch image from apps/disaster-ios/art/Splash-2732.png becomes the Splash set.

   It edits the plist as TEXT rather than parsing it, because the file is
   Xcode's and round-tripping a plist through a parser reorders and reformats
   the whole thing — a diff nobody can review. Each key is replaced in place if
   present and appended before </dict> if not. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DISASTER = path.join(ROOT, "apps/disaster-ios");
const APP = path.join(DISASTER, "ios/App/App");
const PLIST = path.join(APP, "Info.plist");

if (!existsSync(PLIST)) {
  console.error(`No ${path.relative(ROOT, PLIST)} yet.\n` +
    `Generate the Xcode project first (on the Mac):\n\n` +
    `    npm run build:ios\n    (cd apps/disaster-ios && npx cap add ios)\n    node tools/setup-ios.mjs\n`);
  process.exit(1);
}

/* ---- 1. the plist keys -------------------------------------------------- */
const additions = readFileSync(path.join(DISASTER, "Info.plist.additions"), "utf8");
/* Pull <key>…</key> + its value out of the additions file. A value is either a
   self-closing element (<true/>) or an element with a matching close tag. */
const KEYS = [];
const re = /<key>([^<]+)<\/key>\s*((<\w+\/>)|(<(\w+)>[\s\S]*?<\/\5>))/g;
for (const m of additions.matchAll(re)) KEYS.push({ key: m[1], value: m[2].trim() });

let plist = readFileSync(PLIST, "utf8");
const changed = [];
for (const { key, value } of KEYS) {
  const existing = new RegExp(`\\t*<key>${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}</key>\\s*` +
    `((<\\w+/>)|(<(\\w+)>[\\s\\S]*?</\\4>))`);
  const block = `\t<key>${key}</key>\n\t${value.split("\n").join("\n\t")}`;
  if (existing.test(plist)) {
    const before = plist;
    plist = plist.replace(existing, block.replace(/^\t/, ""));
    if (plist !== before) changed.push(key + " (replaced)");
  } else {
    plist = plist.replace(/\n<\/dict>\n<\/plist>/, `\n${block}\n</dict>\n</plist>`);
    changed.push(key + " (added)");
  }
}
writeFileSync(PLIST, plist);
console.log(`Info.plist: ${changed.length ? changed.join(", ") : "already current"}`);

/* ---- 2. the privacy manifest -------------------------------------------- */
copyFileSync(path.join(DISASTER, "PrivacyInfo.xcprivacy"), path.join(APP, "PrivacyInfo.xcprivacy"));
console.log("PrivacyInfo.xcprivacy: copied " +
  "(add it to the App target in Xcode once — File ▸ Add Files, or drag it in)");

/* ---- 3 + 4. the art ------------------------------------------------------ */
function imageSet(dir, contents, from, to) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "Contents.json"), JSON.stringify(contents, null, 2) + "\n");
  copyFileSync(from, path.join(dir, to));
}

const art = path.join(DISASTER, "art");
if (!existsSync(path.join(art, "AppIcon-1024.png"))) {
  console.error("apps/disaster-ios/art is empty — run: node tools/make-app-art.mjs");
  process.exit(1);
}

/* One 1024 image is the whole icon set on Xcode 14+ ("single size"), and iOS
   downsamples it for every slot. Older Xcode wants the full ladder; if you hit
   that, `Assets.xcassets` will tell you which slot is missing. */
imageSet(path.join(APP, "Assets.xcassets/AppIcon.appiconset"), {
  images: [{ filename: "AppIcon-1024.png", idiom: "universal", platform: "ios", size: "1024x1024" }],
  info: { author: "tools/setup-ios.mjs", version: 1 },
}, path.join(art, "AppIcon-1024.png"), "AppIcon-1024.png");

imageSet(path.join(APP, "Assets.xcassets/Splash.imageset"), {
  images: [
    { filename: "Splash-2732.png", idiom: "universal", scale: "1x" },
    { filename: "Splash-2732.png", idiom: "universal", scale: "2x" },
    { filename: "Splash-2732.png", idiom: "universal", scale: "3x" },
  ],
  info: { author: "tools/setup-ios.mjs", version: 1 },
}, path.join(art, "Splash-2732.png"), "Splash-2732.png");
console.log("Assets.xcassets: AppIcon + Splash written");

console.log(`\nNext:\n  (cd apps/disaster-ios && npx cap sync ios)\n  open apps/disaster-ios/ios/App/App.xcworkspace\n` +
  `See apps/disaster-ios/GO-IOS.md for the rest of the submission.`);
