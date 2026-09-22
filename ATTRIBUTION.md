# ATTRIBUTION - third-party code and data in meshtech-phone

Credit where it belongs. Anything not listed under "third-party" is
Brett Stewart's own work (MIT, (c) 2026) or original to this repo.

## Third-party code and protocol references

| Source | What we use | License |
| --- | --- | --- |
| **MeshCore** (meshcore-dev/meshcore) | The wire protocol and companion-radio protocol the app speaks: packet framing, BLE Nordic-UART companion protocol, channel key derivation rules. Reference docs: docs.meshcore.io. | MIT |
| **openhop_core** (github.com, Lloyd Newton, MIT, (c) 2025) | A Python reimplementation of MeshCore used as the wire-protocol REFERENCE: payload type constants, frame layout, and the crypto primitives (sha256, HMAC-SHA256, AES) whose behavior the app's decoder mirrors. | MIT |
| **meshcore SDK / meshcore.js** | Optional BLE companion library referenced at runtime by the web app (`meshclient.ts` imports it when bundled; falls back to direct Web Bluetooth). | MIT |

## Third-party data

| Source | What we use | License |
| --- | --- | --- |
| **Natural Earth** (naturalearthdata.com) | Baked coastline land polygons (`src/lib/coastdata.ts`) used as the map backdrop. Public domain. | Public domain |

## Runtime dependencies (build)

| Source | What we use | License |
| --- | --- | --- |
| **esbuild** (via deno/npm) | The bundler invoked by `build.py`. | MIT |
| **Python 3.12+** | Build/test tooling only; the app itself is dependency-free TypeScript. | PSF |

## What is original here

The scope map concept, the 3x3 area grid, the feed protocol (PULSE /
SECT_SUM / ROUTE / INTRO / LAYOUT packets), the honest-data rules,
and all glue code: Brett Stewart + agents, MIT.
