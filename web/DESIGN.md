# scope-app client PWA - design and structure

The client half of the MeshTech Scope system: a framework-free
progressive web app that runs on an Android phone, talks to a MeshCore
companion radio over BLE/Web Bluetooth, and renders the area health
picture that meshtech-scope hosts broadcast (see
`../meshtech-scope/DESIGN.md` for the host, `PROTOCOL.md` in that
folder for the wire - the wire always wins).

Status: TS suite green (21 codec tests + 6 trail-effect tests at last
run). Built to plain JS by `build.py` because this machine has no npm
toolchain - the only JS runtime is the Deno node-compat binary, and
esbuild comes through Deno's npm compat.

## Why it exists (the problem shape)

The phone is the thing a human actually looks at, but it is also the
node with the least airtime rights. The design keeps the client almost
deaf-and-dumb on purpose: it listens to the shared channel and renders;
its ONLY uplink is a REFRESH_REQ when a section or route it is looking
at is stale. Every feature must survive being a receive-only node in a
mesh it does not control.

## Core philosophy

1. **Receive-only except one hint.** The client never manages hosts,
   never acknowledges, never syncs. `sendRefresh` is the single
   uplink, and the UI words it that way ("the only uplink a client
   makes"). If a refresh is refused or unheard, the UI says so.

2. **Render only what arrived; never fabricate.** Delays the host sent
   as 0 render as "n/a" (unknown), nodes without positions are counted
   but not drawn, hosts without classifications stay visible under the
   "Repeaters only" filter with an honest hidden-count. No plausible
   constants anywhere - the honesty rule from the host side, kept on
   the rendering side.

3. **Everything is attacker-controlled.** The #scope channel secret is
   not authentication: anyone who joins can broadcast. So every string
   off the air (layout names, node names) is escaped at every
   innerHTML sink (`lib/esc.ts`), the CSP meta allows scripts only
   from self, localStorage is read defensively, and the service worker
   never caches a non-200 or a cross-origin response. Full details in
   `SECURITY-REVIEW.md` (2026-09-17, all findings closed).

4. **Per-host data, primary host drives the UI.** Multi-host (wire
   v1.1) means packets carry the sender's origin; `ScopeState` stores
   layouts/health/sections/routes per origin, the first-heard host
   becomes primary and fills the same maps the single-host UI always
   used, and a `hosts()` registry exposes everyone heard (stale hosts
   flagged after 32 min - mirroring the hosts' own 3-missed-beacon
   expiry).

5. **Cheap on the phone.** No framework, no per-frame JS loops for
   animation (trail pulses are SVG SMIL - the browser animates, the
   page sleeps), maps are plain SVG computed from node coordinates,
   and reduced-motion preferences collapse animations to final states
   (`lib/trailfx.ts`).

6. **The trail tells the truth about time.** Routes age publicly:
   live (<=6 min), quiet (<=30 min, dimmed), overdue (<=6 h, dashed),
   ghost (beyond, dimmest hollow dash). A silent route dims but never
   disappears - it still exists.

## Structure (where things live)

```
scope-app/
  index.html            live app shell (connect controls, status chip,
                        log); strict CSP meta
  src/
    main.ts             mounts App on the index.html skeleton
    App.ts              screens: map (section grid) -> section detail
                        (top routes) -> route ghost trail; refresh
                        buttons; Repeaters-only toggle; BLE connect
    demo.ts             the synthetic two-host demo (no radio): plays
                        PROTOCOL-shaped packets through the SAME
                        ScopeState; centred on 94945 / Novato CA with
                        a live route and a deliberately overdue one
    style.css           cards, grid, trail + aging classes (fresh /
                        fading / overdue / ghost), reduced-motion rules
    lib/
      codec.ts          the TypeScript half of the wire contract
                        (byte-identical to the Python codec, pinned by
                        the shared golden vectors)
      state.ts          ScopeState: per-origin storage, primary-host
                        maps, host registry, filteredNodes() class
                        filter (unknown-class nodes always visible)
      grid.ts           GridGeometry port: section rects from a LAYOUT
      trailfx.ts        agingState() classifier + trailFx() pulse
                        markup (SMIL animateMotion; suppressed for
                        reduced motion, single-point or ghost routes)
      esc.ts            esc()/escOr() - the only door from wire
                        strings into innerHTML
      meshclient.ts     Web Bluetooth companion link + meshcore.js
                        dynamic import (kept unbundled - supply-chain
                        note in SECURITY-REVIEW.md)
      codec.test.ts     golden-vector + roundtrip tests
      trailfx.test.ts   aging bands, pulse rules, reduced-motion
      testrunner.ts     tiny test harness for the Deno node-compat run
  sw.js                 service worker: same-origin 200-only app-shell
                        caching, no stale-shell fallback
  build.py              the whole toolchain: runs tests, bundles with
                        esbuild (via Deno), rewrites index.html to the
                        bundle, generates dist/demo.html fresh every
                        build (a stale-redirect bug made this a rule)
  demo_shell.py         the generated demo shell markup
  SECURITY-REVIEW.md    the 2026-09-17 threat model + findings
  dist/                 build output (served as plain files; the
                        Preview tab serves dist/demo.html)
```

## The screen flow

1. **Connect** - link the companion radio; the status chip reports the
   link state. Until connected, the app shows an empty map waiting for
   the area LAYOUT (broadcast hourly and at host start).
2. **Map** - feed-health card (from PULSE: active nodes, mesh RX/hour,
   feed TX/hour estimate, last-pulse age) + the area grid. Each cell
   shows its section id and active-node count; tapping sends nothing -
   it only drills in. "Repeaters only" filters companion-class nodes
   everywhere, always showing hidden counts and never hiding unknowns.
3. **Section detail** - the SECT_SUM stats (active nodes, packets,
   delay p50/p90) and the top routes as stubs. A route without detail
   loaded yet triggers the one permitted uplink: REFRESH_KIND_ROUTE.
4. **Ghost trail** - the route's positioned hops drawn as polyline +
   nodes, with the aging chip and (when the route is live and motion
   is allowed) the pulse travelling the path. Nodes without positions
   are listed honestly, never faked onto the map.

## What the demo is for

`demo.html` runs the identical state/render code against two synthetic
hosts (overlapping areas, so the multi-host storage and hosts-heard
line are exercised) with known positions, classes, and route ages. It
is the visual bench: new features get proved there before any radio
exists, and its data is honest about being synthetic.

## Non-goals (deliberate)

- No tile maps or GPS libraries: sections are SVG rectangles computed
  from the LAYOUT; position truth comes only from INTRO entries.
- No background sync or push: the app is a viewer; the host's SNAP is
  the catch-up mechanism, not a client-side store-and-forward.
- No write path to the mesh beyond REFRESH_REQ (no chat, no config).
- No remote code: no eval, no CDN scripts, meshcore.js stays unbundled
  and pinned by review note until that changes.

## Where the truth lives

- Wire bytes: `../meshtech-scope/PROTOCOL.md` + the shared golden
  vectors (both codecs' tests must stay byte-identical).
- Security posture + accepted risks: SECURITY-REVIEW.md.
- Build/runtime quirks (Deno node-compat, generated demo.html):
  `../.freebuff/run.md` and build.py's comments.
- Current open work: `../meshtech-scope/TODOS.md` (the system's todo
  list lives with the host project) and HANDOFF.md beside it.
