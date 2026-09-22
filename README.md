# meshtech-phone - the client apps for the MeshTech Scope system

One repo, target BRANCHES, one shared base. The phone chapter of the
MeshTech project (see `RULES.md` on main for how we work).

    meshtech-phone/  (BRANCHES, not folders - Brett, 2026-09-22)

      main branch     THE SHARED BASE - app/ holds the map app source
                      (TypeScript, no framework). Shared docs live here.
                      Builds/verifies with `python app/build.py --test`.
      web branch      main + web/ (browser shell: index.html, icon,
                      manifest, service worker) + web docs. The FULL
                      dist is built on this branch.
      android branch  main + the future TWA wrapper (fills on TWA day,
                      stage 5 of PHONE-APP-DESIGN.md).
      apple branch    main + the iOS variant (fills after stage 1).
                      Browser-only: no browser BLE on iOS.
      tools branch    main + helper scripts only (sync_to_node.py,
                      bench serve.py).

## The flow (one direction, no drift)

    main (app/ source)
      -> each target branch adds only its shell/wrapper
      -> web branch: build.py -> dist/ -> sync_to_node.py -> meshtech-node/app/

A fix to shared code is made ONCE on main, then merged into the four
target branches (quick mechanical merges). A branch never changes app
behavior - it only adds its specialization. See SHARED.md.

## Status

Stage 1 (WiFi/TCP on the phone, responsive layout, install-ready) is
the first build. See `RULES.md` (on main) for stage order and the
decided channel (TWA - never call it PWA).
