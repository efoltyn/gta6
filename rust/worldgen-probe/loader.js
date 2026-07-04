// loader.js — minimal Node loader for the worldgen-probe .wasm module.
// No wasm-bindgen, no build-time glue: `WebAssembly.instantiate` on the raw
// bytes is the entire integration surface. The exact same pattern (swap
// `fs.readFileSync` for `fetch(...).then(r => r.arrayBuffer())`) works
// unmodified in a browser tab or a Web Worker — see check.html and
// worker_loader_example.js in this directory.
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_WASM_PATH = path.join(
  __dirname,
  "target/wasm32-unknown-unknown/release/worldgen_probe.wasm"
);

/**
 * @param {string} [wasmPath]
 * @returns {Promise<{instance: WebAssembly.Instance, exports: any, memory: WebAssembly.Memory}>}
 */
async function loadWorldgen(wasmPath = DEFAULT_WASM_PATH) {
  const bytes = fs.readFileSync(wasmPath);
  // No imports required: the module is self-contained (its own bump-arena
  // memory, no host functions called in). `instantiate` needs no importObject.
  const { instance } = await WebAssembly.instantiate(bytes);
  return {
    instance,
    exports: instance.exports,
    memory: instance.exports.memory,
  };
}

/**
 * Convenience wrapper: allocate a scratch buffer inside the module's own
 * linear memory via its bump allocator, run `scatter_chunk`, and return the
 * instances as a plain JS array of {x, z, scale, rot}.
 */
function scatterChunkJS(wasm, seed, chunkX, chunkZ, capInstances = 4096) {
  const capBytes = capInstances * 4 * 4; // 4 floats * 4 bytes
  const ptr = wasm.exports.alloc(capBytes);
  const count = wasm.exports.scatter_chunk(seed >>> 0, chunkX | 0, chunkZ | 0, ptr, capBytes) >>> 0;
  const floats = new Float32Array(wasm.memory.buffer, ptr, count * 4);
  const instances = [];
  for (let i = 0; i < count; i++) {
    instances.push({
      x: floats[i * 4],
      z: floats[i * 4 + 1],
      scale: floats[i * 4 + 2],
      rot: floats[i * 4 + 3],
    });
  }
  return instances;
}

module.exports = { loadWorldgen, scatterChunkJS, DEFAULT_WASM_PATH };

// `node loader.js` on its own runs a tiny smoke test.
if (require.main === module) {
  loadWorldgen().then((wasm) => {
    console.log("exports:", Object.keys(wasm.exports));
    const h = wasm.exports.hash_u32(42, 90210);
    console.log("hash_u32(42, 90210) =", h >>> 0);
    const instances = scatterChunkJS(wasm, 90210, 0, 0);
    console.log(`scatter_chunk(90210, 0, 0) -> ${instances.length} instances, first =`, instances[0]);
  });
}
