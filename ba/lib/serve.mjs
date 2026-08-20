/* ba/lib/serve.mjs — the AFTER side has to come from somewhere.

   Ported from a python devserver that the engine used to spawn by absolute
   path, which quietly made python3 a dependency of a "zero-dependency" tool
   and made the tool unusable in any repo that did not have that exact file.
   This is the same server in the standard library we already require, plus
   the option to hand the job to the project's own dev server instead.

   Three behaviors came across because each one was a bug that cost a day:

     no-store on every response — the point of a before/after is that the
     AFTER side is the code on disk right now. A 304 from a warm cache
     photographs the previous run and the report lies.

     .wasm pinned to application/wasm — WebAssembly.instantiateStreaming
     refuses anything else, and the stdlib mime guess is platform dependent.

     HTTP/1.1 keep-alive (node's default, stated here so nobody "optimizes"
     it away) — a page that fires ~300 file requests on load will exhaust
     sockets and start 502-ing through a tunnel if every file opens a new
     connection.

   Range support is the one addition: python's SimpleHTTPRequestHandler
   ignores Range and answers 200 with the whole file, which works for media
   but wastes the transfer on every seek. */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  // the one that is not a guess
  ".wasm": "application/wasm",
};

const contentType = (file) => MIME[path.extname(file).toLowerCase()] || "application/octet-stream";

/** Substitute {port} anywhere it appears in a configured command or URL. */
export const withPort = (text, port) => String(text).replaceAll("{port}", String(port));

function noCache(response) {
  response.setHeader("Cache-Control", "no-store, must-revalidate");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
}

// "bytes=START-END", either end optional. Anything else is unsatisfiable and
// the caller falls back to a plain 200 — a wrong 206 is far worse than none.
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!match || size <= 0) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;
  let start, end;
  if (rawStart === "") {
    const length = Number(rawEnd);
    if (!length) return null;
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}

function makeHandler(root) {
  return async function handle(request, response) {
    let filePath;
    try {
      const requested = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (requested.includes("\0")) throw new Error("bad path");
      filePath = path.resolve(root, "." + path.posix.normalize(requested));
    } catch (_) {
      noCache(response);
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("bad request\n");
      return;
    }
    // Serving the project root means serving exactly the project root.
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      noCache(response);
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("forbidden\n");
      return;
    }

    let info;
    try {
      info = await stat(filePath);
      if (info.isDirectory()) {
        filePath = path.join(filePath, "index.html");
        info = await stat(filePath);
      }
    } catch (_) {
      noCache(response);
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }

    noCache(response);
    response.setHeader("Content-Type", contentType(filePath));
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Last-Modified", info.mtime.toUTCString());

    if (request.method === "HEAD") {
      response.setHeader("Content-Length", String(info.size));
      response.writeHead(200);
      response.end();
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    const range = request.headers.range ? parseRange(request.headers.range, info.size) : null;
    if (range) {
      response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
      response.setHeader("Content-Length", String(range.end - range.start + 1));
      response.writeHead(206);
    } else {
      response.setHeader("Content-Length", String(info.size));
      response.writeHead(200);
    }
    const stream = createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined);
    stream.on("error", () => response.destroy());
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => { server.removeListener("listening", onListening); reject(err); };
    const onListening = () => { server.removeListener("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Builtin static server over `root`.
 * `port` is a preference, not a promise: a busy port falls back to whatever
 * the OS hands out, because a run that dies on "address in use" after
 * booting a browser is a stupid way to lose a comparison.
 * Returns { url, port, close }.
 */
export async function start({ root, port = 0 }) {
  const server = http.createServer(makeHandler(path.resolve(root)));
  server.keepAliveTimeout = 30000;
  server.headersTimeout = 35000;
  try {
    await listen(server, Number(port) || 0);
  } catch (err) {
    if (err && err.code === "EADDRINUSE" && Number(port)) await listen(server, 0);
    else throw err;
  }
  const actual = server.address().port;
  return {
    url: `http://127.0.0.1:${actual}/`,
    port: actual,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Hand the serving job to the project's own dev server.
 * `{port}` is substituted in both command and url so the two agree, then we
 * wait for the URL to answer at all. "Answers" deliberately includes a 404:
 * the server being up is what we can verify here; whether the configured URL
 * is the right page is the preset's readiness expression to decide, and it
 * says so with far better evidence than a poll loop could.
 * Returns { url, port, close }.
 */
export async function startCommand({ command, url, port = 0, root, timeoutMs = 60000, env }) {
  const chosen = Number(port) || 3000 + Math.floor(Math.random() * 2000);
  const line = withPort(command, chosen);
  const target = withPort(url || "http://127.0.0.1:{port}/", chosen);
  const child = spawn(line, {
    cwd: root || process.cwd(),
    env: { ...process.env, PORT: String(chosen), ...(env || {}) },
    stdio: "ignore",
    shell: true,
    // its own process group: `npm run dev` is a shell that forks the real
    // server, and killing only the shell leaves the port held forever.
    detached: process.platform !== "win32",
  });
  let exited = null;
  child.on("exit", (code, signal) => { exited = signal || code; });

  const close = async () => {
    if (child.killed || exited != null) return;
    try {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch (_) { try { child.kill("SIGTERM"); } catch (_) {} }
  };

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (exited != null) throw new Error(`serve command exited (${exited}) before ${target} answered: ${line}`);
    try {
      const response = await fetch(target, { method: "GET" });
      if (response.status < 500) { await response.body?.cancel().catch(() => {}); break; }
    } catch (_) {}
    if (Date.now() > deadline) {
      await close();
      throw new Error(`serve command never answered at ${target} within ${Math.round(timeoutMs / 1000)}s: ${line}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { url: target, port: chosen, close };
}

/** Start whatever `config.serve` asked for. */
export async function startForConfig(config, { port = 0 } = {}) {
  if (config.serve && config.serve.mode === "command") {
    return startCommand({ ...config.serve, port, root: config.projectRoot });
  }
  return start({ root: config.projectRoot, port });
}
