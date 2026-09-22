#!/usr/bin/env python3
"""Build scope-app's dist/ - no npm toolchain needed.

Uses esbuild through the Deno node-compat binary found on this machine
(the only JS runtime present). Safe to re-run; idempotent.

    python build.py           # bundle app + demo, copy shell files
    python build.py --test    # also run the codec golden-vector tests
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent
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
    shutil.copy(APP / "index.html", dist / "index.html")
    index = dist / "index.html"
    html = index.read_text(encoding="utf-8").replace(
        '<script type="module" src="/src/main.ts"></script>',
        '<link rel="stylesheet" href="./app.css" />\n'
        '  <script type="module" src="./app.js"></script>')
    index.write_text(html, encoding="utf-8")

    for name in ("manifest.webmanifest", "icon.svg", "sw.js"):
        shutil.copy(APP / name, dist / name)

    # dist/demo.html is GENERATED (demo_shell.py) - never copied from
    # the repo root, whose demo.html is only a redirect to dist/.
    from demo_shell import DEMO_HTML
    (dist / "demo.html").write_text(DEMO_HTML, encoding="utf-8")
    print(f"\nBuilt {dist} - serve it over TLS (or localhost) and open "
          "index.html. Demo: demo.html")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
