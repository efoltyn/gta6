// worker_loader_example.js — the Web Worker loader pattern for
// worldgen-probe's .wasm, so chunk generation can run off the main thread.
// This file defines BOTH halves (worker + how the main thread talks to it)
// since the whole point is showing the message-passing shape; split them
// into two files in a real integration.
//
// ---- worker half (this would be `worldgen.worker.js`) ----------------------
//
//   self.onmessage = async (e) => {
//     if (e.data.type !== "init") return;
//     const { instance } = await WebAssembly.instantiateStreaming(
//       fetch(e.data.wasmUrl)
//     );
//     const wasm = instance.exports;
//     self.postMessage({ type: "ready" });
//
//     self.onmessage = (e2) => {
//       if (e2.data.type !== "generateChunk") return;
//       const { seed, chunkX, chunkZ, requestId } = e2.data;
//       const capInstances = 4096;
//       const capBytes = capInstances * 4 * 4;
//       const ptr = wasm.alloc(capBytes);
//       const count = wasm.scatter_chunk(seed >>> 0, chunkX | 0, chunkZ | 0, ptr, capBytes) >>> 0;
//       // Copy OUT of wasm memory before transferring, since wasm.memory.buffer
//       // is a single growable ArrayBuffer you don't want to transfer away
//       // from the module that still owns it.
//       const floats = new Float32Array(wasm.memory.buffer, ptr, count * 4).slice();
//       self.postMessage({ type: "chunkReady", requestId, count, floats }, [floats.buffer]);
//     };
//   };
//
// ---- main-thread half -------------------------------------------------------
//
//   const worker = new Worker("worldgen.worker.js");
//   worker.postMessage({ type: "init", wasmUrl: "./target/wasm32-unknown-unknown/release/worldgen_probe.wasm" });
//   worker.onmessage = (e) => {
//     if (e.data.type === "ready") {
//       worker.postMessage({ type: "generateChunk", seed: 90210, chunkX: 3, chunkZ: -1, requestId: 1 });
//     } else if (e.data.type === "chunkReady") {
//       console.log(`chunk ready: ${e.data.count} instances`, e.data.floats);
//     }
//   };
//
// Why this shape: `alloc`/`scatter_chunk`/`memory` are the same three exports
// used on the main thread in check.html and loader.js — a Worker is just a
// separate WASM instance (each `WebAssembly.instantiate` call creates its own
// linear memory), so there's no shared-memory hazard to reason about unless
// you deliberately opt into a `SharedArrayBuffer`-backed WebAssembly.Memory
// (not needed here: chunk generation is embarrassingly parallel across
// workers by construction, since the hash is keyed on world position, not
// on any cross-chunk state).

"use strict";

// This file also runs as a REAL Worker end-to-end smoke test, so the pattern
// above is proven, not just asserted. Run: `node worker_loader_example.js`
// (uses Node's built-in worker_threads + a self-contained wasm loader, no
// browser required, since the message-passing shape is identical).
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const path = require("path");

if (isMainThread) {
  const wasmPath = path.join(
    __dirname,
    "target/wasm32-unknown-unknown/release/worldgen_probe.wasm"
  );
  const worker = new Worker(__filename, { workerData: { wasmPath } });
  worker.on("message", (msg) => {
    if (msg.type === "ready") {
      worker.postMessage({ type: "generateChunk", seed: 90210, chunkX: 3, chunkZ: -1, requestId: 1 });
    } else if (msg.type === "chunkReady") {
      console.log(`worker smoke test: chunk (3,-1) -> ${msg.count} instances, first =`, msg.floats.slice(0, 4));
      worker.terminate();
    }
  });
} else {
  const fs = require("fs");
  (async () => {
    const bytes = fs.readFileSync(workerData.wasmPath);
    const { instance } = await WebAssembly.instantiate(bytes);
    const wasm = instance.exports;
    parentPort.postMessage({ type: "ready" });

    parentPort.on("message", (msg) => {
      if (msg.type !== "generateChunk") return;
      const capInstances = 4096;
      const capBytes = capInstances * 4 * 4;
      const ptr = wasm.alloc(capBytes);
      const count = wasm.scatter_chunk(msg.seed >>> 0, msg.chunkX | 0, msg.chunkZ | 0, ptr, capBytes) >>> 0;
      const floats = new Float32Array(wasm.memory.buffer, ptr, count * 4).slice();
      parentPort.postMessage({ type: "chunkReady", requestId: msg.requestId, count, floats }, [floats.buffer]);
    });
  })();
}
