// Minimal zero-dependency RFC6455 WebSocket server for Node.
// Text frames only (the game protocol is JSON), ping/pong, close, basic
// fragmentation. Enough for a game relay; not a general-purpose ws library.
"use strict";
const crypto = require("crypto");

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MSG = 512 * 1024; // hard cap per message: snapshots are ~10-40KB

class WSConn {
  constructor(socket) {
    this.socket = socket;
    this.alive = true;
    this.onmessage = null; // (string) => void
    this.onclose = null; // () => void
    this._buf = Buffer.alloc(0);
    this._frag = null; // accumulating fragmented message
    socket.setNoDelay(true);
    socket.on("data", (d) => this._onData(d));
    const dead = () => this._dead();
    socket.on("close", dead);
    socket.on("error", dead);
    socket.on("end", dead);
  }

  _dead() {
    if (!this.alive) return;
    this.alive = false;
    this.socket.destroy();
    if (this.onclose) this.onclose();
  }

  send(str) {
    if (!this.alive) return;
    const payload = Buffer.from(str, "utf8");
    this.socket.write(frame(0x1, payload));
  }

  ping() {
    if (this.alive) this.socket.write(frame(0x9, Buffer.alloc(0)));
  }

  close(code = 1000) {
    if (!this.alive) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code, 0);
    this.socket.write(frame(0x8, b));
    // give the close frame a moment to flush, then drop
    setTimeout(() => this._dead(), 250);
  }

  _onData(d) {
    this._buf = this._buf.length ? Buffer.concat([this._buf, d]) : d;
    if (this._buf.length > MAX_MSG * 2) return this._dead(); // flooding
    let f;
    while ((f = parseFrame(this._buf))) {
      this._buf = this._buf.subarray(f.consumed);
      if (!this._handleFrame(f)) return; // connection died
    }
  }

  _handleFrame(f) {
    if (f.bad) { this._dead(); return false; }
    switch (f.opcode) {
      case 0x1: // text
      case 0x2: // binary (treated as text payload)
        if (f.fin) {
          this._emit(f.payload);
        } else {
          this._frag = [f.payload];
        }
        break;
      case 0x0: // continuation
        if (!this._frag) { this._dead(); return false; }
        this._frag.push(f.payload);
        if (this._frag.reduce((n, b) => n + b.length, 0) > MAX_MSG) { this._dead(); return false; }
        if (f.fin) {
          const whole = Buffer.concat(this._frag);
          this._frag = null;
          this._emit(whole);
        }
        break;
      case 0x8: // close
        this._dead();
        return false;
      case 0x9: // ping -> pong
        if (this.alive) this.socket.write(frame(0xA, f.payload));
        break;
      case 0xA: // pong
        this.lastPong = Date.now();
        break;
      default:
        this._dead();
        return false;
    }
    return this.alive;
  }

  _emit(buf) {
    if (buf.length > MAX_MSG) return this._dead();
    if (this.onmessage) {
      try { this.onmessage(buf.toString("utf8")); }
      catch (e) { console.error("[ws] onmessage handler error:", e); }
    }
  }
}

function frame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

// Returns {fin, opcode, payload, consumed} | {bad:true, consumed} | null (need more data)
function parseFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    const big = buf.readBigUInt64BE(2);
    if (big > BigInt(MAX_MSG)) return { bad: true, consumed: buf.length };
    len = Number(big);
    off = 10;
  }
  if (len > MAX_MSG) return { bad: true, consumed: buf.length };
  if (!masked) return { bad: true, consumed: buf.length }; // clients MUST mask
  if (buf.length < off + 4 + len) return null;
  const mask = buf.subarray(off, off + 4);
  const payload = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) payload[i] = buf[off + 4 + i] ^ mask[i & 3];
  return { fin, opcode, payload, consumed: off + 4 + len };
}

// Attach to an http.Server. cb(conn, req) on each new websocket.
function attach(httpServer, path, cb) {
  httpServer.on("upgrade", (req, socket, head) => {
    const url = (req.url || "").split("?")[0];
    if (url !== path) { socket.destroy(); return; }
    const key = req.headers["sec-websocket-key"];
    if (!key || (req.headers.upgrade || "").toLowerCase() !== "websocket") {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    const conn = new WSConn(socket);
    if (head && head.length) conn._onData(head);
    cb(conn, req);
  });
}

module.exports = { attach, WSConn };
