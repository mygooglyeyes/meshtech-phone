# SHARED.md - how code flows (one base, three targets)

The rule: **web/ is the only place app code is written.** The other
targets consume it; they never fork it.

    web/  (the shared base, TypeScript)
      |
      |  build.py -> dist/
      |
      +--> meshtech-node/app/   (what hilltop serves to a PC browser)
      |    via: python tools/sync_to_node.py
      |    (gates on tests - a failing build never syncs)
      |
      +--> android/ (stage 5)   TWA wraps the same dist, no code change
      |
      +--> apple/   (later)     same source + iOS icon/stylesheet tweak

Consequences:

- A fix made in android/ or apple/ that touches app behavior is in the
  WRONG place - move it to web/ and re-sync.
- "Which copy is live?" is answered by sync_to_node.py, never by hand.
- After a sync, meshtech-node's app/ copy is committed in the SERVER
  repo (that repo carries the served bundle) - with Brett's OK, as
  always.
