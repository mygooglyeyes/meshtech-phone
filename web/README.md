# web/ - the shared base app

Seeded 2026-09-22 from C:\projects\scope-app (the working PC client),
unmodified, so the new repo starts from exactly what runs today.

- Build: `python build.py` (bundles TS -> dist/, runs the test suite
  with `python build.py --test`).
- The renderer, wire codec (layout/pulse/section summaries), direct
  TCP-WS client and MeshCore BLE client all live in `src/`.
- Full documentation of the app's design and protocols stays with the
  original project docs (scope-app README and the WEBSERVE-PROTOCOL.md
  in meshtech-node) until this repo's docs pass (TODOS.md).

After changing anything here: `python tools/sync_to_node.py` from the
repo root builds, tests, and copies the result into meshtech-node's
served app/ folder. Commit there only with Brett's OK.
