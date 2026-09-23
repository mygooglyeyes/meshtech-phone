# meshtech-phone - TODOS.md (order matters, top first)

Kept current per the AGENTS.md rule. Done items move to the archive
note at the bottom when finished.

## In progress

- STAGE 1 polish session (2026-09-22 afternoon/evening): BLE/TCP
  labels, one-line header (disconnected + Connect + radio-name),
  halved connection select (same right edge), right-edge alignment,
  collapsible Feed health (title + carat), brightness pass (panels,
  text, map corner numbers, section ID numbers). ALL COMMITTED on
  main + synced to web/android/apple/tools. NOT PUSHED.
- Bench server for phone testing: python http.server on port 8620,
  serving app/dist, bound 0.0.0.0 (http://192.168.12.200:8620/).
  PID 6352. HTTPS still needed for full Android install prompt.

## Next up (awaiting Brett's pick)

- PUSH v00.000.002: everything above, needs Brett's word.
- HTTPS bench server: self-signed cert so the phone can complete the
  Android install (install prompt is held back on plain HTTP).
- STAGE 1 CLOSE-OUT: phone feel confirmed by Brett (looks good
  "for now" 2026-09-22 evening).

## Parked / future (do not start without Brett)

- STAGE 2: BLE mode (Heltec companion radio, MeshCore firmware,
  Android only).
- STAGE 5: TWA packaging (Bubblewrap, signing keys, hilltop serves
  /.well-known/assetlinks.json).
- DOCS POLISH: README.md + ATTRIBUTION.md + LICENSE get their full
  pass (Brett, 2026-09-22 - files exist, content needs its final edit).
- DYNAMIC GRID: 2x2..5x5 map sizes (wire already supports it; costs
  documented - sweep time, refresh budget).
- DELTA DATA: send only what changed in pulses (design day needed,
  golden vectors both sides).
- ZOOM-OUT VIEW + "focus area" button + user-configurable map
  center/size (20/40/60 km, cost note).
- COVERAGE AUDIT: count our nodes in openhop repeater's history db
  (apples-to-apples "are we getting all packets?" test).
- CONTACTS IMPORT: fill the db from the companion radio's node list.

## Archive (done, kept briefly for context)

- 2026-09-22 (evening): STAGE 1 BUILD complete - responsive layout,
  PNG icons 192/512 + maskable, service-worker registration (with
  update-on-load, the Ctrl+F5 wedge fix), manifest fixes. Phone
  layout iterated with Brett live over the bench server.
- 2026-09-22: repo created (seeded from scope-app, docs, sync script).
- 2026-09-22: BRANCH LAYOUT built per Brett: main = shared app/ source
  + docs; web/android/apple/tools branches add only their
  specialization; build.py shell-optional (verifies on main, full dist
  on web); SHARED.md/README/PROJECT rewritten for branches. Tests
  green on main and web.
