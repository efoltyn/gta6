/* tools/shot/gitserve.mjs — serve a COMMIT over http, straight out of the git
   object store. No checkout, no worktree, no copy.

   Why: ten agents asking for shots of ten branches would need ten worktrees
   (seconds each, disk churn, cleanup) to serve the old way. A commit is
   already a complete, immutable file tree in .git; `git ls-tree -r` maps its
   paths to blob ids once (ms), and one long-lived `git cat-file --batch`
   process hands out the blobs. Blobs are cached by id, so fifty commits that
   share 99% of their files share 99% of the cache.

     /<path>            the file at the server's base commit
     /@<sha>/<path>     the file at ANY commit (the hot-swap path: a warm page
                        pulls one branch's species file without a reload)

   serveCommit(repo, commit) -> { port, origin, commit, setCommit(c), close() } */
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".wasm": "application/wasm",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".txt": "text/plain",
  ".bin": "application/octet-stream", ".ktx2": "image/ktx2", ".hdr": "application/octet-stream",
};

/* ---- the object store, shared by every server in this process ---------- */
const STORES = new Map();
function store(repo) {
  if (STORES.has(repo)) return STORES.get(repo);
  const S = { repo, trees: new Map(), blobs: new Map(), blobBytes: 0, proc: null, queue: [], buf: Buffer.alloc(0), cur: null };
  const start = () => {
    S.proc = spawn("git", ["cat-file", "--batch"], { cwd: repo, stdio: ["pipe", "pipe", "ignore"] });
    S.buf = Buffer.alloc(0); S.cur = null;
    S.proc.stdout.on("data", (d) => { S.buf = Buffer.concat([S.buf, d]); pump(); });
    S.proc.on("exit", () => {
      S.proc = null;
      for (const q of S.queue) q.reject(new Error("git cat-file exited"));
      S.queue = [];
      if (S.cur) { S.cur.reject(new Error("git cat-file exited")); S.cur = null; }
    });
  };
  const pump = () => {
    for (;;) {
      if (!S.cur) { S.cur = S.queue.shift() || null; if (!S.cur) return; }
      const nl = S.buf.indexOf(10);
      if (nl < 0) return;
      const head = S.buf.subarray(0, nl).toString();
      if (/ missing$/.test(head)) { S.buf = S.buf.subarray(nl + 1); const c = S.cur; S.cur = null; c.resolve(null); continue; }
      const size = +head.split(" ")[2];
      if (S.buf.length < nl + 1 + size + 1) return;
      const body = Buffer.from(S.buf.subarray(nl + 1, nl + 1 + size));
      S.buf = S.buf.subarray(nl + 1 + size + 1);
      const c = S.cur; S.cur = null; c.resolve(body);
    }
  };
  S.blob = (oid) => {
    const hit = S.blobs.get(oid);
    if (hit) { S.blobs.delete(oid); S.blobs.set(oid, hit); return Promise.resolve(hit); }
    if (!S.proc) start();
    return new Promise((resolve, reject) => {
      S.queue.push({ resolve: (b) => {
        if (b) {
          S.blobs.set(oid, b); S.blobBytes += b.length;
          // LRU: keep the cache under ~400 MB
          for (const [k, v] of S.blobs) { if (S.blobBytes < 400e6) break; S.blobs.delete(k); S.blobBytes -= v.length; }
        }
        resolve(b);
      }, reject });
      S.proc.stdin.write(oid + "\n");
    });
  };
  /* path -> blob id for a commit (one ls-tree per commit, cached) */
  S.tree = (commit) => {
    let t = S.trees.get(commit);
    if (t) return t;
    t = new Map();
    const out = execFileSync("git", ["ls-tree", "-r", "-z", "--full-tree", commit], { cwd: repo, maxBuffer: 256 << 20 }).toString();
    for (const row of out.split("\0")) {
      if (!row) continue;
      const tab = row.indexOf("\t");
      const [, type, oid] = row.slice(0, tab).split(" ");
      if (type === "blob") t.set(row.slice(tab + 1), oid);
    }
    S.trees.set(commit, t);
    if (S.trees.size > 64) S.trees.delete(S.trees.keys().next().value);
    return t;
  };
  S.read = async (commit, rel) => {
    const oid = S.tree(commit).get(rel);
    return oid ? S.blob(oid) : null;
  };
  STORES.set(repo, S);
  return S;
}
export function readAt(repo, commit, rel) { return store(repo).read(commit, rel); }
export function treeOf(repo, commit) { return store(repo).tree(commit); }

export async function serveCommit(repo, commit) {
  const S = store(repo);
  const st = { commit };
  const srv = http.createServer(async (req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (_) { res.writeHead(400); return res.end(); }
    let at = st.commit;
    const m = /^\/@([0-9a-f]{7,40})(\/.*)$/.exec(rel);
    if (m) { at = m[1]; rel = m[2]; }
    if (rel.endsWith("/")) rel += "index.html";
    rel = path.posix.normalize(rel).replace(/^\/+/, "");
    if (rel.startsWith("..")) { res.writeHead(403); return res.end(); }
    let body = null;
    try { body = await S.read(at, rel); } catch (_) {}
    if (!body) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(rel).toLowerCase()] || "application/octet-stream",
      "Content-Length": body.length, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  srv.keepAliveTimeout = 30000;
  for (let t = 0; t < 40; t++) {
    const port = 40000 + Math.floor(Math.random() * 9000);
    const ok = await new Promise((r) => { srv.once("error", () => r(false)); srv.listen(port, "127.0.0.1", () => r(true)); });
    if (ok) {
      return {
        port, origin: `http://127.0.0.1:${port}/`,
        get commit() { return st.commit; }, setCommit(c) { st.commit = c; },
        close() { try { srv.close(); srv.closeAllConnections && srv.closeAllConnections(); } catch (_) {} },
      };
    }
  }
  throw new Error("shot: no free port for a commit server");
}
