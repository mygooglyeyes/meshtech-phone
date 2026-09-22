# SHARED.md - how code flows (one base, target BRANCHES)

The rule: **app code is written on main, the shared branch.** The
target branches consume it; they never fork it differently.

    main    THE SHARED BRANCH - app/ source + shared docs
      |        (everything every target needs)
      |
      +--> web branch     = main + web/ (browser shell: index, icon,
      |                     manifest, SW) + web docs
      |                     build.py finds web/ and emits a full dist
      +--> android branch = main + the TWA wrapper files (stage 5)
      +--> apple branch   = main + iOS shell tweaks (later)
      +--> tools branch   = main + helper scripts only
                              (sync_to_node, bench serve)

Consequences (Brett's branch shape, 2026-09-22):

- A fix to shared code happens ONCE on main, then main is merged into
  web/android/apple/tools - quick mechanical merges, nothing rewritten.
- A branch may add ONLY its own specialization (shell files, wrapper,
  docs). App behavior changes belong on main, never on a branch.
- "Which copy is live?" is answered by sync_to_node.py (tools branch),
  never by hand. After a sync, meshtech-node's app/ copy is committed
  in the SERVER repo - with Brett's OK, as always.
- Tests (`python app/build.py --test`) run on ANY branch: main verifies
  shared code, target branches verify their full dist.
