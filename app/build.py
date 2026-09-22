#!/usr/bin/env python3
"""Build scope-app's dist/ - no npm toolchain needed.

Uses esbuild through the Deno node-compat binary found on this machine
(the only JS runtime present). Safe to re-run; idempotent.

    python build.py           # bundle app + demo, copy shell files
    python build.py --test    # also run the codec golden-vector tests
"""
from __future__ import annotations

import base64
import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).absolute().resolve().parent  # app/ - the folder holding this build script
DENO_CANDIDATES = [
    # SCOPE_RUNTIME overrides everything (Docker images set it to deno).
    Path(os.environ["SCOPE_RUNTIME"]) if os.environ.get("SCOPE_RUNTIME") else None,
    Path.home() / "AppData/Local/deno/node_compat_bin/node.exe",
    Path("C:/Program Files/nodejs/node.exe"),
    # Portable fallbacks for Linux/macOS containers and dev boxes.
    Path(shutil.which("deno") or "missing-deno"),
    Path(shutil.which("node") or "missing-node"),
]


def find_runtime() -> Path:
    for candidate in DENO_CANDIDATES:
        if candidate and candidate.is_file():
            return candidate
    raise SystemExit(
        "No JS runtime found (looked for the Deno node-compat binary and "
        "node.exe). Install Deno or Node, then re-run.")


def run(cmd: list[str], **kwargs) -> None:
    print("+", " ".join(str(c) for c in cmd))
    result = subprocess.run(cmd, cwd=APP, **kwargs)
    if result.returncode != 0:
        raise SystemExit(f"command failed ({result.returncode}): {cmd}")


def run_tests(runtime: Path) -> None:
    """Run the TS test suites under whichever runtime we found.

    Real deno rejects node-only flags (first Docker build lesson,
    2026-09-18): `--enable-source-maps` is node syntax. The Windows
    node-compat shim accepts node flags; true deno needs `run -A`.
    """
    tests = ("src/lib/codec.test.ts", "src/lib/trailfx.test.ts",
             "src/lib/areamap.test.ts", "src/lib/routes.test.ts")
    if runtime.name.startswith("deno"):
        base = [str(runtime), "run", "-A"]
    else:
        base = [str(runtime), "--enable-source-maps"]
    for test in tests:
        run(base + [test])


def main() -> int:
    argv = sys.argv[1:]
    node = find_runtime()
    print(f"Using runtime: {node}")

    if "--test" in argv:
        run_tests(node)

    dist = APP / "dist"
    dist.mkdir(exist_ok=True)
    for src_name in ("main.ts", "demo.ts"):
        out_name = "app.js" if src_name == "main.ts" else "demo.js"
        run([str(node), "run", "-A", "npm:esbuild",
             "--bundle", f"src/{src_name}",
             "--outfile=" + f"dist/{out_name}",
             "--format=esm", "--minify"])

    # index.html ships pointing at /src/main.ts; rewrite to the bundle.
    # The browser shell (index/icon/manifest/sw) lives on the TARGET
    # branches under web/ (android/ and apple/ add their own later),
    # not on main (shared-only). Shell found -> full dist; not found ->
    # bundle + tests still verify the shared code, cleanly.
    shell_dir = next((d for d in (APP.parent / "web", APP)
                      if (d / "index.html").exists()), None)
    if shell_dir is not None:
        shutil.copy(shell_dir / "index.html", dist / "index.html")
        index = dist / "index.html"
        html = index.read_bytes().decode("utf-8").replace(
            '<script type="module" src="/src/main.ts"></script>',
            '<link rel="stylesheet" href="./app.css" />\n'
            '  <script type="module" src="./app.js"></script>')

        # STAGE 1 CSP self-heal (2026-09-22): the SW-registration script
        # is inline, so the policy carries its sha256. A hash pinned in
        # the source would drift the moment git line-ending conversion
        # or an editor re-save touches the file (caught live: CRLF
        # working copy vs LF-authored hash). The build hashes the ACTUAL
        # bytes it is about to ship and rewrites the policy tag - the
        # pair can never disagree again. Non-inline-script policies are
        # left untouched (no hash marker present).
        CSP_MARK = "sha256-BUFFY_COMPUTES_ME"
        if CSP_MARK in html:
            import base64
            import re as _re
            m = _re.search(r"<script>(.*?)</script>", html, _re.S)
            if not m:
                raise SystemExit("CSP marker present but no inline script found")
            body = m.group(1)
            # Chromium normalizes CRLF to LF while parsing; its CSP
            # hash is computed over the NORMALIZED body. Match that
            # or the hash pair breaks on CRLF working copies (live
            # lesson 2026-09-22).
            body = body.replace("\r\n", "\n")
            b64 = base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode()
            html = html.replace(CSP_MARK, f"sha256-{b64}")
        index.write_bytes(html.encode("utf-8"))

        for name in ("manifest.webmanifest", "icon.svg", "sw.js",
                     "icon-192.png", "icon-512.png",
                     "icon-maskable-192.png", "icon-maskable-512.png"):
            if (shell_dir / name).exists():
                shutil.copy(shell_dir / name, dist / name)
    else:
        print("(no browser shell on this branch - bundling + tests only; "
              "run this build on the web branch for a full dist)")

    # dist/demo.html is GENERATED (demo_shell.py) - never copied from
    # the repo root, whose demo.html is only a redirect to dist/.
    from demo_shell import DEMO_HTML
    (dist / "demo.html").write_text(DEMO_HTML, encoding="utf-8")
    print(f"\nBuilt {dist} - serve it over TLS (or localhost) and open "
          "index.html. Demo: demo.html")  # index.html only on shell branches
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
