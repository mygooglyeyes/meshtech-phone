# RULES.md - meshtech-phone working rules (Brett + agents)

The phone repo's copy of the interaction rules. AGENTS.md governs
everything in C:\projects; this file carries the rules that matter
here, plus the phone-specific decisions. When in doubt: AGENTS.md
first, then PROJECT.md (meshtech-node), then this.

## The channel decision (Brett, 2026-09-22 - never re-litigate)

- The OFFICIAL app channel is a **Trusted Web Activity (TWA)**.
- Stages 1-2 run as the plain **web app in the browser** - the
  proving ground. Nothing is wasted: the web app IS the TWA content.
- Interim WebAPK install (Chrome auto-mint) is a convenience, not
  the destination.

## Stage order (PHONE-APP-DESIGN.md governs; summary)

1. Web app on the phone: responsive, installable, WiFi/TCP to
   hilltop. Verified on Brett's phone.
2. BLE in the same web app: pair the Heltec V4.3 (MeshCore companion
   firmware), hear #scope. TX stays OFF.
3. Hilltop TX ON - Brett's explicit go, one toggle, bench first.
4. Ledger/cache/ages per PHONE-CONNECT.md (5 refreshes/hour,
   cache-first, honest ages).
5. TWA packaging: Bubblewrap, hilltop serves assetlinks.json, real
   APK. The official app.

## Hard rules carried from the server project

- Describe first, Brett says go, THEN build. No exceptions.
- One change at a time; every reply: 👁️ READ / ▶️ DO / 📋 PASTE.
- Never fabricate data; a missing number shows as missing.
- Never commit or push without Brett's explicit OK (one commit = one
  OK, said before the commit).
- Commands Brett runs go in a fenced code block (copy button works).
- Honest gaps: "I don't know" beats a guess dressed as a fact.

## Repo rules

- web/ is the single source of truth for app code. android/ and
  apple/ hold ONLY their specialization; fixes go in web/ and flow
  out via the build.
- After every web build: run the sync script so meshtech-node's
  served copy is never stale.
- Tests before any push (web/: `python build.py --test`).
