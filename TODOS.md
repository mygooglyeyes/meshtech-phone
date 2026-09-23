# meshtech-phone - TODOS.md (order matters, top first)

Kept current per the AGENTS.md rule. Done items move to the archive
note at the bottom when finished.

## In progress

- (none - v00.000.003 pushed 2026-09-22 late night; tree clean)

## Session log (recent, for context)

- v00.000.003 (pushed): THE ZERO-DOTS FIX (live INTRO positions
  re-projected against the LAYOUT center; delta decode against 0,0
  put every dot 10,000 km off-map - Brett verified 7 dots live),
  Map refresh pill pinned top-right of the map card (wiring moves
  with the card re-render), host/password row hides while connected
  and returns the instant the link drops.
- Bench server for phone testing: python http.server on port 8620,
  serving app/dist, bound 0.0.0.0 (http://192.168.12.200:8620/).
  PID 6352. HTTPS still needed for full Android install prompt.

## Next up (awaiting Brett's pick)

- POSITION AUDIT (Brett, 2026-09-22 night, TOP PRIORITY): two
  repeaters NEAR HIM advert location, yet the server shows ZERO nodes
  with a position. Something in the advert-decode -> node-store ->
  feed path is dropping or never receiving positions. Find where the
  location data dies - packet capture, decode, storage, or feed.
- HTTPS bench server: self-signed cert so the phone can complete the
  Android install (install prompt is held back on plain HTTP).
- STAGE 1 CLOSE-OUT: phone feel confirmed by Brett (looks good
  "for now" 2026-09-22 evening); v00.000.002 pushed.

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
