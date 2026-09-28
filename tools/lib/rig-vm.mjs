/* tools/lib/rig-vm.mjs — the REAL human rig in plain node (no browser):
   three r128 + world/materials.js + systems/fphands.js + entities/character.js
   (+ optional extra files) in one vm context. Shared by the torso checks. */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../../", import.meta.url);
export const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
export function loadRig(extra) {
  const ctx = vm.createContext({ console, Math, performance });
  ctx.window = ctx; ctx.self = ctx;
  ctx.CBZ = { CONFIG: {}, onAlways() {}, onUpdate() {}, on() {} };
  const files = ["src/vendor/three.r128.min.js", "src/world/materials.js", "src/systems/fphands.js", "src/entities/character.js"].concat(extra || []);
  for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
  return ctx;
}
