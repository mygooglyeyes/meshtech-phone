#!/usr/bin/env python3
"""Bench server for dist/ with no-store caching + bench log mirror.

Two bench-only jobs (SECURITY-REVIEW.md: never deploy this server):

1. `Cache-Control: no-store` on every response so a reload always
   re-fetches - Chrome heuristic caching kept stale bytes after a
   rebuild (the "gray fog" seen 2026-09-18).
2. POST /bench/log: appends request bodies to
   .freebuff/bench-log/app.log so the agent can READ the web app's
   event log off disk during live bench sessions - Brett no longer
   hand-copies log lines (2026-09-18). The app posts only from
   logLine(), only on this local server; nothing radio-secret passes
   through (the app never sees the PIN). Without the endpoint the
   app's mirror POST quietly fails - bench-only by construction.

Run from the repo root:
    python tools/serve.py [port]     # default port 8616
"""
import sys
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DIST = "dist"
LOG_DIR = Path(__file__).resolve().parent.parent / ".freebuff" / "bench-log"
LOG_FILE = LOG_DIR / "app.log"


class NoStoreHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def do_POST(self):
        # Bench log mirror: body = one or more log lines, plain text.
        if self.path.rstrip("/") != "/bench/log":
            self.send_error(404)
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            n = 0
        body = self.rfile.read(n).decode("utf-8", "replace") if n else ""
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as f:
            for line in body.splitlines():
                if line.strip():
                    f.write(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {line}\n")
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):  # quiet-ish bench log
        sys.stderr.write("[serve] " + (fmt % args) + "\n")


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8616
    srv = ThreadingHTTPServer(("127.0.0.1", port), NoStoreHandler)
    print(f"serving dist/ on http://127.0.0.1:{port} (no-store; POST /bench/log -> {LOG_FILE})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
