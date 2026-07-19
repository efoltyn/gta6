#!/usr/bin/env python3
"""Dev static server for Cell Block Z.

Serves the repo root with no-cache headers so a manual browser refresh always
fetches the latest files (no stale JS), while NOT auto-reloading open tabs.
That matches the goal: little changes don't disturb a live session; a refresh
reliably gets the new code.
"""
import http.server
import os
import socketserver

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("PORT", "8000"))


class Handler(http.server.SimpleHTTPRequestHandler):
    # HTTP/1.1 enables keep-alive: the ~300 file requests this game fires on
    # load reuse connections instead of opening one per file, which is what
    # was overwhelming the tunnel and causing 502s.
    protocol_version = "HTTP/1.1"

    # WebAssembly.instantiateStreaming refuses anything that isn't served as
    # application/wasm; the stdlib mimetypes guess is OS/Python-version
    # dependent, so pin it here (sqlite3.wasm broke behind the tunnel).
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # Force the browser to revalidate on every load so a refresh = fresh code.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # quiet


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print(f"serving {ROOT} on http://127.0.0.1:{PORT}")
        httpd.serve_forever()
