"""Sync the built web app into meshtech-node's served folder.

THE SEAM KILLER (Brett, 2026-09-22): the server's app/ copy used to be
updated by hand - two places for one truth, and "which copy is live?"
confusion. Now: build (or reuse dist/) then copy in one command.

    python tools/sync_to_node.py            # build + sync
    python tools/sync_to_node.py --no-build # sync existing dist only
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DIST = WEB / "dist"
NODE = Path(r"C:\projects\meshtech-node")
NODE_APP = NODE / "app"

# What the server serves (matches meshtech-node git-tracked app/).
FILES = ["index.html", "app.js", "demo.js", "app.css", "demo.css",
         "icon.svg", "manifest.webmanifest", "sw.js"]


def main() -> int:
    build = "--no-build" not in sys.argv
    if build:
        print("== building web/ ==")
        r = subprocess.run([sys.executable, str(WEB / "build.py"), "--test"],
                           cwd=str(WEB))
        if r.returncode != 0:
            print("BUILD FAILED - nothing synced (tests gate the sync)")
            return 1
    if not DIST.exists():
        print("no dist/ - run without --no-build first")
        return 1
    if not NODE_APP.exists():
        print(f"meshtech-node not found at {NODE} - sync skipped")
        return 1
    copied = []
    for name in FILES:
        src = DIST / name
        if src.exists():
            shutil.copy2(src, NODE_APP / name)
            copied.append(name)
    print(f"synced {len(copied)} file(s) -> {NODE_APP}")
    print("NOTE: meshtech-node serves this copy; commit it there with "
          "Brett's OK (the server repo carries the served bundle).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
