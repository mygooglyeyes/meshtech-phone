# meshtech-phone android/ - the future TWA wrapper

EMPTY ON PURPOSE (seeded 2026-09-22).

This folder fills on STAGE 5 (TWA packaging day), after stages 1-2
are proven. What lands here then (from PHONE-APP-DESIGN.md section 8):

- Bubblewrap config (twa-manifest.json) pointing at web/'s build
- signing keys (never committed - local only)
- build outputs (gitignored)

The wrapper depends on ONE server-side file too:
meshtech-node serves /.well-known/assetlinks.json so the APK and
hilltop can prove they belong together. Remembered in TODOS.md.
