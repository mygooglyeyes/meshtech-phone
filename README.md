# meshtech-phone - the client apps for the MeshTech Scope system

One repo, three targets, one shared base. The phone chapter of the
MeshTech project (see `RULES.md` at the root for how we work).

    meshtech-phone/
      web/      THE SHARED BASE - the map app (TypeScript, no framework).
                Builds with `python build.py`; meshtech-node serves the
                built dist. This is what runs on Brett's PC today and
                what every other target wraps.
      android/  THE OFFICIAL ANDROID APP - a Trusted Web Activity (TWA)
                wrapper around web/ (Bubblewrap; built on "app day",
                stage 5 of PHONE-APP-DESIGN.md).
      apple/    iOS web-app specialization (apple-touch-icon, iOS
                styling). Browser-only: no browser BLE on iOS.

## The flow (one direction, no drift)

    web/  --build.py-->  dist/  --sync script-->  meshtech-node/app/

The server never edits the client; the client never edits the server.
`tools/sync_to_node.py` (run after every build) copies the built
output into meshtech-node's served `app/` folder so the manual-copy
mistake can never happen again.

## Status

Stage 1 (WiFi/TCP on the phone, responsive layout, install-ready) is
the first build. See `RULES.md` for stage order and the decided
channel (TWA).
