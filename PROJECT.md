# meshtech-phone - PROJECT.md (the plain-words truth)

Last verified by Brett: 2026-09-22 (seeded - Brett reviews line by line
and this line gets updated each time).

This document is THE truth for this project. If code and this doc
disagree, the doc wins, or the doc gets fixed first.

## What this project is

The CLIENT apps for the MeshTech Scope system. The server (meshtech-node,
on the hilltop Pi) listens to the mesh radio and serves the processed
map. This repo holds what runs on the OTHER side of the link:

    meshtech-phone/
      web/      THE SHARED BASE - the map app (same code as scope-app).
                Today it runs in a browser on Brett's PC and talks to
                hilltop over WiFi/TCP (the "direct" connection).
      android/  the future official Android app (TWA wrapper). EMPTY
                for now - filled on TWA day (stage 5).
      apple/    the future iOS variant (browser-based; iPhone gets WiFi
                only - Apple blocks browser BLE). EMPTY for now.
      tools/    sync_to_node.py - builds web/ and copies the result
                into meshtech-node's served app/ folder. No more
                manual copying.

## The design (from PHONE-APP-DESIGN.md in meshtech-node - keep in sync)

- The official app channel is a TWA (Trusted Web Activity): our web
  app wrapped as a real Android app. Decided. Never call it PWA.
- Stage 1: make the existing web app work well on a phone screen
  (browser, WiFi/TCP to hilltop). No server changes.
- Stage 2: BLE mode - the phone pairs to the Heltec companion radio
  and hears the map off the air (Android only).
- Stage 5: TWA packaging day (Bubblewrap, signing, one small file on
  hilltop). Not before stages 1-2 are proven on walks.

## The channel rule (Brett, 2026-09-22)

The phone app's job: stand in for the future "phone + companion radio"
device. Over WiFi/TCP now, over BLE later. The web app is SELF
CONTAINED - pages are served from the device showing them, never
fetched across the link. The link carries DATA ONLY (the feed).

## Rules of the road

- Brett confirms before every commit, push, and box action.
- One decision = one explicit go from Brett.
- Tests run without permission; they always run before a commit.
- Attribution: third-party credit lives in ATTRIBUTION.md. MIT license
  (LICENSE). The docs-polish pass is a future todo.
