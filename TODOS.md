# meshtech-phone - TODOS.md (order matters, top first)

Kept current per the AGENTS.md rule. Done items move to the archive
note at the bottom when finished.

## In progress

- (none - repo just seeded)

## Next up (awaiting Brett's pick)

- STAGE 1 BUILD: phone-ready web app - responsive layout, PNG icons
  (192/512), service-worker registration, manifest fixes. Feeds the
  interim Android install feel AND the future TWA. No server changes.

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

- 2026-09-22: repo created (web/ seeded from scope-app, android/ and
  apple/ placeholders, RULES.md, README.md, ATTRIBUTION.md, LICENSE,
  PROJECT.md, TODOS.md, sync script).
