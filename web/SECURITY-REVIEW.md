# Security review - scope-app + scope feed (2026-09-17)

Super-tight review requested by Brett after the multi-host build and
the node-class toggle. Scope: the PWA (`scope-app`), its wire inputs
(meshtech-scope feed packets over the companion), the service worker,
and the host-side guards the app depends on. Result: **all findings
fixed in this pass** unless marked ACCEPTED. Python 73/73, TS 21/21
after the fixes.

## Threat model (what an attacker actually controls)

- **The `#scope` channel is shared and its secret is shareable.** The
  default secret is the public hashtag derivation sha256("#scope")[:16];
  anyone who joins the channel can SEND. Every packet the app decodes
  is therefore ATTACKER-CONTROLLED input - the channel secret is a
  privacy/noise filter, NOT an authentication boundary.
- Unauthenticated hosts: the multi-host design lets any node claim an
  origin and broadcast feed packets (a hostile "ghost host"). Accepted
  consequence for v1: worst case = misinformation on a hobby map; the
  wire has no do-more-damage primitive. Mitigations: secret_hex private
  channel, and the host-side ACL for uplinks.
- Uplink identity (REFRESH_REQ origin) is unauthenticated and spoofable.
- Browser-side: localStorage is user/script-writable; the app is served
  over http.server on the bench (plain HTTP).

## Findings and dispositions

### F1. innerHTML sinks with wire-controlled strings - FIXED (Critical)

LAYOUT `name` and INTRO node names arrive over the air and were
interpolated into innerHTML unescaped. A hostile packet could inject
script/HTML (stored-style XSS surviving only in memory, but served to
every view render). Fix: `src/lib/esc.ts` esc()/escOr(); applied at
both renderers (App renderMap layout name, demo ghost-trail names);
pinning test "esc neutralises wire-string injection" added. Audit
comment marks every remaining interpolation as number-or-fixed-string;
new wire strings must pass esc()/textContent.

### F2. Service worker could cache a poisoned/broken shell - FIXED (High)

The network fallback cached ANY response including 404/500/portal
HTML under the shell key, and `.catch(() => hit)` could serve a stale
shell forever - a bricked PWA needing manual storage clear. Fix:
same-origin requests only; only `resp.ok` responses are cached;
network failures surface instead of serving frozen cache.

### F3. Unbounded host memory from spoofed uplink identities - FIXED (High)

RefreshDedupe / RefreshRateLimiter kept per-nonce and per-client state
forever; a flood of unique nonces or random prefixes grows the host's
RAM without limit (denial of service against the plugin on the box).
Fix: hard caps (4096 dedupe entries with oldest-eviction; 512 client
entries with LRU-style eviction). Pure state machines, unit-tested.

### F4. No CSP - FIXED (Defense in depth)

Both HTML shells (index.html + generated dist/demo.html via
demo_shell.py) now carry a strict CSP meta tag: default-src 'self';
script-src 'self'; style-src 'self' 'unsafe-inline' (inline styles
only); object-src 'none'; base-uri 'none'; form-action 'none';
connect-src 'self'. If any escaping is ever missed, injected script
still cannot run external sources or exfiltrate via fetch to third
parties. Verified: app + demo render clean, zero console errors.

### F5. localStorage trust - FIXED (Low)

clientOrigin() now reads defensively (type-checks, catches denied
storage in private mode, regenerates on garbage). The id is not a
secret and grants nothing by itself.

### F6. Meshcore library / bundler supply chain - ACCEPTED (documented)

meshclient.ts dynamically imports meshcore.js when a bundler provides
it. Today nothing bundles it (bench fallback only); the dynamic import
target is a string, not a URL, so no remote-code path exists. Rule
recorded: if meshcore.js is ever bundled, PIN the exact version from
npm (verified upstream 2026-09-17: official MIT repo + @liamcottle/
meshcore.js 1.15.0) and review the diff on upgrades.

### F7. Plain-HTTP bench serving - ACCEPTED (bench-only)

`python -m http.server` is fine for the bench; before any real-world
distribution the PWA must be served over TLS (Web Bluetooth also
requires a secure context). README already notes this.

### F8. Uplink DoS / spoofing at the mesh layer - MITIGATED, inherent limit

Hosts already rate-limit per prefix, dedupe nonces, ACL by pubkey
prefix, and hard-cap airtime (the budget limiter is the real guard:
24 pkt/h, 1% duty). A determined attacker with the channel secret can
still spoof REFRESH_REQ origins; the damage ceiling is "a map refresh
somebody else would have paid for". The ACL (feed.allowed_prefixes)
is the strong option when it matters. Documented, no code change.

## What was checked and found SOUND

- Codec decoders (both languages): bounds-checked on every field,
  raise CodecError on truncation - no crash path from hostile bytes
  (fuzz-style truncated-payload test exists for PULSE; decoders share
  the same pattern).
- XSS surface: the ONLY wire strings in the whole app are layout name
  and node names; everything else is numeric. esc() test pins the
  behaviour; CSP covers regressions.
- Web Bluetooth path: Nordic UART only, requestDevice with explicit
  service filter; no eval, no remote code, no third-party requests.
- Host: no shell-out, no SQL (no DB yet), no path traversal from
  config (paths come from config.json the operator owns); token file
  read-only; demo mode never touches radio or network.
- Secret handling: channel secret stays in the companion radio; the
  plugin never logs or transmits it; no secrets in config.json
  (token_file indirection pattern, same as the answerbot).
- No telemetry, no analytics, no external network calls of any kind.

## Follow-through rules

1. Every NEW wire string -> esc()/textContent + a test. The audit
   comments in App.ts/renderMap mark the invariant.
2. If a bundler/library enters the build (meshcore.js, map tiles),
   pin versions + re-run this review.
3. Before hilltop install: private channel secret_hex (not the public
   hashtag derivation), and consider feed.allowed_prefixes ACL.
4. Re-run pytest (73) + build.py --test (21) after any change here;
   both green at time of writing.
