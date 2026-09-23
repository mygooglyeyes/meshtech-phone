/**
 * Scope PWA main logic (framework-free; mounted by main.ts).
 *
 * Screens: map with section grid -> section detail (top routes) ->
 * route ghost trail. Refresh buttons send REFRESH_REQ uplinks.
 * Feed-health card shows what the feed spends (from PULSE).
 */

import "./style.css";
import { MeshClient, type LinkState } from "./lib/meshclient.ts";
import {
  DirectClient, type DirectState,
} from "./lib/directclient.ts";
import { ScopeState } from "./lib/state.ts";
import {
  NODE_CLASS_COMPANION, REFRESH_HOST_ANY, REFRESH_KIND_ROUTE,
  REFRESH_KIND_SECTION, REFRESH_WHOLE_AREA, encodeRefreshReq, type Route,
  type ScopePacket,
  type SectSum,
} from "./lib/codec.ts";
import { esc, escOr } from "./lib/esc.ts";
import { trailFx, startTrailPulse, AGING_LABEL } from "./lib/trailfx.ts";
import { areaMapSvg, sectionMapSvg } from "./lib/areamap.ts";
import { routeDisplayName } from "./lib/routes.ts";

const state = new ScopeState();
// Set when a packet arrives for the route currently on screen: the
// trail then replays its moving dot ONCE (live-data proof), otherwise
// the trail is a static readout (Brett 2026-09-18).
let routeUpdateFlash: number | null = null;
const client = new MeshClient({
  onState: (s: LinkState, detail?: string) => renderConnection(s, detail),
  // RX VISIBILITY (live-link debugging 2026-09-18): every frame and
  // every decoded scope packet leaves one event-log line. The 1-byte
  // "empty mailbox" poll receipts (0x0a NO_MORE_MSGS) are filtered -
  // they arrive every second and drowned everything useful.
  onRaw: (frame: Uint8Array) => {
    if (frame.length <= 1) return; // empty poll receipt, not news
    const t = frame[0];
    if (t === 0x0a || t === 0x82 || t === 0x88) return; // poll ack / ack / RF log
    logLine(`ble frame type 0x${t.toString(16).padStart(2, "0")} ${frame.length}B`);
  },
  onPacket: (packet: ScopePacket, meta) => {
    logLine(
      `scope ${packet.kind} received` +
        (meta?.snr != null ? ` (snr ${meta.snr.toFixed(1)}dB)` : ""),
    );
    if (
      packet.kind === "route" && selectedRoute === packet.routeId &&
      selectedRoute != null
    ) {
      routeUpdateFlash = packet.routeId;
    }
    state.apply(packet);
    render();
  },
  onLog: (line: string) => logLine(line),
});

// ---------------------------------------------------------------- DIRECT mode
// meshtech-node's WebServe (WEBSERVE-PROTOCOL.md): the same packets
// the radio path yields, over WebSocket. One source at a time, chosen
// explicitly by the user; every packet line is tagged [radio]/[direct]
// so the Gate 2 cross-check is a two-second eyeball job.
let sourceMode: "radio" | "direct" = "radio";
let refreshCounter = 0;

function tagSource(line: string): string {
  return sourceMode === "direct" ? `[direct] ${line}` : `[radio] ${line}`;
}

// Connect button LOOK follows the link: "Connect ..." when down,
// plain "Disconnect" when live (pressed-in style via dataset.mode).
// Clicking it while live drops the link and the button returns to
// "Connect ..." (Brett, 2026-09-21: NOT "Connect node - Disconnect" -
// the connected label must be the one word that says what it does).
function syncConnectButton(connected: boolean, connecting: boolean): void {
  const btn = el<HTMLButtonElement>("connect");
  btn.textContent = connected ? "Disconnect" : modeLabel(sourceMode);
  btn.dataset.mode = connected ? "connected" : "open";
  btn.disabled = connecting;
}

function modeLabel(mode: "radio" | "direct"): string {
  return mode === "direct" ? "Connect node" : "Connect radio";
}

const direct = new DirectClient({
  onState: (s: DirectState, detail?: string) => {
    const chip = el<HTMLSpanElement>("conn-state");
    chip.textContent = s + (detail ? ` - ${detail}` : "");
    chip.dataset.state = s === "connected" ? "connected" : s;
    syncConnectButton(s === "connected", s === "connecting");
    // LINK-row honesty (Brett 2026-09-22): once connected, the host/
    // password boxes only take space - the link is live, nothing to
    // type. They return the moment the link drops (any non-connected
    // state), so a failed connect can be edited immediately.
    el<HTMLDivElement>("node-link-row").hidden = s === "connected";
  },
  onPacket: (packet, meta) => {
    logLine(tagSource(
      `scope ${packet.kind} received` +
      (meta?.snr != null ? ` (snr ${meta.snr.toFixed(1)}dB)` : "")));
    if (
      packet.kind === "route" && selectedRoute === packet.routeId &&
      selectedRoute != null
    ) {
      routeUpdateFlash = packet.routeId;
    }
    state.apply(packet);
    render();
  },
  onReset: () => {
    logLine("[direct] node restarted - local map state dropped, " +
      "fresh LAYOUT incoming");
    state.resetAll(); // everything we hold is stale by definition
    render();
  },
  onLog: (line: string) => logLine(tagSource(line)),
});

// ---------------------------------------------------------------- helpers

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function logLine(line: string): void {
  const log = el<HTMLDivElement>("log");
  const div = document.createElement("div");
  div.textContent = `[${new Date().toLocaleTimeString()}] ${line}`;
  log.prepend(div);
  // 200 lines (was 40): the 10-second link heartbeat eats 40 lines in
  // ~7 minutes, erasing packet events mid-observation (Brett,
  // 2026-09-18 live hunt).
  while (log.childElementCount > 200) log.lastChild?.remove();
  // BENCH MIRROR (restored 2026-09-21, the quick-drop hunt): POST
  // every log line to the local server's /bench/log so the browser
  // side of a mystery is ON DISK, not just in a vanishing log view.
  // S4 removed the old mirror as a silent 404; tools/serve.py DOES
  // route it (204). Fire-and-forget, errors ignored.
  if (location.port === "8616") {
    void fetch("/bench/log", {
      method: "POST",
      body: line,   // serve.py appends plain-text lines, one per line
    }).catch(() => { /* logging must never break the app */ });
  }
}

// ---------------------------------------------------------------- actions

async function onConnect(): Promise<void> {
  if (sourceMode === "direct") {
    if (direct.linkState === "connected") {
      direct.disconnect();
      return;
    }
    // SELF-CONTAINED RULE (PROJECT.md 2026-09-21): this app is served
    // from THIS device and takes FEED DATA from a host node over the
    // network - the link replaces the companion-radio link. Address
    // typed once, password once (both remembered in the browser).
    const host = el<HTMLInputElement>("node-host").value.trim();
    if (!host) {
      logLine("enter the host node address first (e.g. 192.168.12.145)");
      return;
    }
    const token = el<HTMLInputElement>("node-token").value.trim();
    if (token) localStorage.setItem("node-token", token);
    if (host) localStorage.setItem("node-host", host);
    const saved = localStorage.getItem("node-token") || "";
    // Port comes from what the user typed ("host:port"); a bare host
    // means the node's standard web port 8710.
    const [hostName, port] = host.includes(":")
      ? [host.slice(0, host.indexOf(":")), host.slice(host.indexOf(":") + 1)]
      : [host, "8710"];
    const url = `ws://${hostName}:${port}/feed`;
    direct.connect(url, saved || undefined);
    return;
  }
  const name = el<HTMLInputElement>("radio-name").value.trim();
  await client.connect(name || undefined);
}

/** ws(s)://<same host>/feed - the node serves this app, same origin. */
function directUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/feed`;
}

function sendRefresh(kind: number, target: number): void {
  const nonce = Math.floor(Math.random() * 0xffff) + 1;
  // v1.1: origin identifies this client to the hosts' rate limiters;
  // host=0 means "owner decides" (the multi-host election rule).
  const payload = encodeRefreshReq({
    seq: nonce, origin: clientOrigin(), refreshKind: kind, target,
    host: REFRESH_HOST_ANY, nonce,
  });
  if (sourceMode === "direct") {
    // Over the wire: the node dispatches a real RefreshReq through the
    // SAME dedupe + rate limiter an on-air request takes (no bypass).
    const reqId = `r${Date.now()}-${++refreshCounter}`;
    // v1.2: target 0 = whole-area whatever the kind - say "map" in the
    // log instead of the old confusing "section target=0".
    const kindName = kind === REFRESH_KIND_ROUTE
      ? (target === REFRESH_WHOLE_AREA ? "map" : "route")
      : (target === REFRESH_WHOLE_AREA ? "map" : "section");
    direct.sendRefresh(payload, reqId, kindName, target, clientOrigin());
    return;
  }
  client.send(payload).then((ok) => {
    // client.send() already logs the precise reason (not connected /
    // no #scope slot / TX error) - don't overwrite it with a guess.
    if (!ok) logLine("refresh request NOT sent - see reason above");
    else logLine(`refresh request sent (kind=${kind} target=${target})`);
  });
}

/**
 * This client's stable 2-byte id (persisted per install).
 *
 * SECURITY (review 2026-09-17): localStorage can hold anything a user
 * or another script puts there - read defensively, never trust the
 * stored value's type, and regenerate when it is not a sane integer.
 * The id is not a secret and grants nothing by itself; hosts still
 * rate-limit per prefix and can ACL.
 */
function clientOrigin(): number {
  const KEY = "scope.clientOrigin";
  let v = NaN;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) v = Number(raw);
  } catch {
    v = NaN; // storage denied (private mode etc.) - fresh id per session
  }
  if (!Number.isInteger(v) || v < 1 || v > 0xffff) {
    v = Math.floor(Math.random() * 0xfffe) + 1;
    try {
      localStorage.setItem(KEY, String(v));
    } catch {
      // storage denied - session-local id, harmless
    }
  }
  return v;
}

// ---------------------------------------------------------------- render

function renderConnection(s: LinkState, detail?: string): void {
  const chip = el<HTMLSpanElement>("conn-state");
  chip.textContent = s + (detail ? ` - ${detail}` : "");
  chip.dataset.state = s;
  syncConnectButton(s === "connected", s === "connecting");
}

function fmtDelay(seconds: number | null): string {
  if (seconds == null) return "n/a";
  return seconds >= 90 ? `${Math.round(seconds / 60)} min` : `${seconds}s`;
}

// Feed health COLLAPSES by default (Brett 2026-09-22): the map is
// the main event, so the stats shrink to a title + carat row. Session
// state (module var) so the 1-second repaint never pops it open.
let feedHealthOpen = false;

function renderFeedHealth(): string {
  const h = state.health;
  if (h.lastPulseTs == null) {
    return `<div class="card collapsible${feedHealthOpen ? "" : " collapsed"}"><h3 id="fh-toggle" class="fhtoggle">Feed health <span class="chev">${feedHealthOpen ? "▾" : "▸"}</span></h3>
      <p class="muted">No PULSE received yet. The host sends one every
      few minutes - or press Request map refresh once connected.</p></div>`;
  }
  const age = renderFeedHealth.age();
  // Mapped nodes (Brett, 2026-09-21): CLIENT-side count - nodes that
  // are actually ON our map: have a position AND fall inside the area
  // rectangle (a node with GPS outside the grid is real but not on
  // THIS map; counting it made the stat claim dots that aren't there).
  // Derived live, never waiting on a server stat.
  const mapped = state.geometry
    ? state.positionedNodes().filter((n) =>
        n.lat! >= state.geometry!.south && n.lat! <= state.geometry!.north &&
        n.lon! >= state.geometry!.west && n.lon! <= state.geometry!.east
      ).length
    : 0;
  return `<div class="card collapsible${feedHealthOpen ? "" : " collapsed"}"><h3 id="fh-toggle" class="fhtoggle">Feed health <span class="chev">${feedHealthOpen ? "▾" : "▸"}</span></h3>
    <div class="statgrid">
      <div><span class="big">${h.activeTotal ?? "?"}</span>active nodes</div>
      <div><span class="big">${mapped}</span>mapped nodes</div>
      <div><span class="big">${h.rxPerHour ?? "?"}</span>mesh RX/hour</div>
      <div><span class="big">${h.feedAirtimeSPerH ?? "?"}s</span>feed TX/hour (est.)</div>
      <div><span class="big">${age}</span>since last pulse</div>
    </div></div>`;
}

// A one-second housekeeping tick (the ONLY timer in the app): the card
// repaints so the pulse age counts UP live between bursts. Without it
// the number froze at "1s" for five minutes (the card only repainted
// on packet arrival, which always lands ~1s after a pulse).
renderFeedHealth.age = (): string => {
  const ts = state.health.lastPulseTs;
  if (ts == null) return "?";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;   // Brett: minutes:seconds, never mental math
};
setInterval(() => {
  if (state.health.lastPulseTs != null) render();
}, 1000);

function renderMap(): string {
  // Map refresh lives ON the map card now (Brett 2026-09-22): a small
  // button pinned top-right of the card title row. Same handler as
  // before (wired by id in boot()); only its home moved.
  const refreshBtn = `<button id="refresh-map" class="maprefresh">Map refresh</button>`;
  if (!state.geometry) {
    return `<div class="card"><h3>Map ${refreshBtn}</h3>
      <p class="muted">Waiting for the area LAYOUT packet from the host
      (broadcast hourly, and at host start)...</p></div>`;
  }
  const { hidden } = state.filteredNodes(repeatersOnly);
  const counts: (number | null)[] = [];
  // v1.2: section ids are 1-based everywhere (wire, logs, UI) - the
  // wire value IS the number on screen, section 1 = upper-left.
  for (let i = 1; i <= state.geometry.sectionCount; i++) {
    const sect = state.sections.get(i);
    counts.push(sect?.activeNodes
      ?? state.health.sectionCounts?.[i - 1]
      ?? null);
  }
  const repeatersOnlyNote = repeatersOnly && hidden > 0
    ? `<p class="muted">${hidden} companion node(s) hidden. Nodes the
      host has not classified always stay visible.</p>`
    : "";
  // SECURITY (review 2026-09-17): the layout NAME above comes off the
  // air and is esc()'d; every other interpolation here is a number or
  // a fixed string. Node names reach the DOM only via esc() inside
  // areamap.ts <title> tooltips. Keep it that way.
  return `<div class="card"><h3>${esc(state.layout?.name || "Area")}
    <span class="muted">(${state.geometry.grid}x${state.geometry.grid},
    ~${Math.round(state.geometry.spanM / 1000)} km across)</span>${refreshBtn}</h3>
    <label class="filter"><input type="checkbox" id="filter-repeaters"
      ${repeatersOnly ? "checked" : ""}/> Repeaters only</label>
    <label class="filter"><input type="checkbox" id="show-section-numbers"
      ${showSectionNumbers ? "checked" : ""}/> Section numbers</label>
    ${areaMapSvg({
      grid: state.geometry.grid,
      west: state.geometry.west,
      south: state.geometry.south,
      spanDeg: state.geometry.spanDeg,
      counts,
      nodes: [...state.nodes.values()],
      showSectionNumbers,
    })}
    ${repeatersOnlyNote}
    <p class="muted">Small corner number = active nodes the host heard
    in that section. Dots = nodes that published a position (fewer is
    normal - not every node shares GPS). Select a section for its top
    routes.</p></div>`;
}

function renderSectionDetail(id: number): string {
  const sect = state.sections.get(id);
  const stubs = sect?.routeStubs ?? [];
  const rows = stubs.map((rid, i) => {
    const route = state.routes.get(rid);
    // Human label with graphical arrows (Brett: nobody memorizes hex);
    // hops not yet heard render honestly as "N unnamed node(s)".
    const name = route
      ? routeDisplayName(route.prefixes.map((p) =>
        state.nodes.get(p)?.name))
      : "unnamed route";
    return `<button class="route" data-route="${rid}" data-hover="${rid}" data-section="${id}">
      <span class="rname">Route ${i + 1} - ${name}</span>
      <span class="rmuted">${route ? `${route.packetCount} pkts, delay ${fmtDelay(route.delayMedS)} (est.)` : "detail not loaded"}</span>
    </button>`;
  }).join("");
  // Zoomed geographic view of THIS section: coastline + dots, no grid.
  // Route ghost paths pre-drawn hidden; hovering a route row lights
  // its path on the map (same behaviour as the demo bench).
  let mapBlock = "";
  if (state.geometry) {
    const r = state.geometry.section(id);
    mapBlock = sectionMapSvg({
      sectionId: id,
      west: r.west, south: r.south, east: r.east, north: r.north,
      squareWest: state.geometry.west,
      squareSouth: state.geometry.south,
      squareSpan: state.geometry.spanDeg,
      nodes: [...state.nodes.values()],
      hoverRoutes: stubs
        .map((rid) => state.routes.get(rid))
        .filter((rt): rt is NonNullable<typeof rt> => !!rt)
        .map((rt) => ({
          routeId: rt.routeId,
          points: rt.prefixes
            .map((p) => state.nodes.get(p))
            .filter((n) => n && n.lat != null && n.lon != null)
            .map((n) => ({ lon: n!.lon!, lat: n!.lat! })),
        }))
        .filter((hr) => hr.points.length >= 2),
    });
  }
  return `<div class="card"><h3>Section ${id}</h3>
    ${mapBlock}
    ${sect ? `<div class="statgrid">
      <div><span class="big">${sect.activeNodes}</span>active nodes</div>
      <div><span class="big">${sect.packetCount}</span>packets</div>
      <div><span class="big">${fmtDelay(sect.delayP50S)}</span>delay p50 (est.)</div>
      <div><span class="big">${fmtDelay(sect.delayP90S)}</span>delay p90 (est.)</div>
    </div>` : `<p class="muted">No summary received for this section yet.</p>`}
    <div class="routes">${rows || `<p class="muted">No routes yet.</p>`}</div>
    <button id="refresh-section" class="primary">Request section refresh</button>
    <button id="back">Back to map</button>
  </div>`;
}

function renderGhostTrail(route: Route): string {
  // Client-side animation over positioned nodes; nodes without
  // positions are listed, never faked onto the map. With the
  // repeaters-only view on, companion-class hops drop out of the
  // trail (counted honestly, never silently merged into 'missing').
  const visible = route.prefixes.filter((p) => {
    const n = state.nodes.get(p);
    return !(repeatersOnly && (n?.nodeClass ?? 0) === NODE_CLASS_COMPANION);
  });
  const hiddenByFilter = route.prefixes.length - visible.length;
  const points = visible
    .map((p) => state.nodes.get(p))
    .filter((n) => n && n.lat != null && n.lon != null);
  const missing = visible.length - points.length;
  // x = lon, y = lat; viewBox fits the actual nodes (fixed bug:
  // the old static viewBox clipped everything off-screen).
  const lons = points.map((n) => n!.lon!);
  const lats = points.map((n) => n!.lat!);
  // Trail effects (TODOS #16): aging class. NO looped animation on
  // open - the moving dot only replays when live data arrives for
  // this route (Brett 2026-09-18; see trailfx.ts). The replay hook
  // is wired in render() via lastRouteUpdateAt.
  const fx = trailFx({
    points: points.map((n) => ({ lon: n!.lon!, lat: n!.lat! })),
    lastHeardMin: route.lastHeardMin,
  });
  // NORTH IS UP: the trail svg plots lon against lat, and SVG's y
  // axis grows DOWNWARD - so lat must be reflected inside the viewBox
  // (same convention the area map pins with areamap.test). The old
  // code fed raw latitudes: the trail rendered upside-down.
  const minLat = points.length > 0 ? Math.min(...lats) : 0;
  const maxLat = points.length > 0 ? Math.max(...lats) : 0;
  const fy = (lat: number): number => maxLat + minLat - lat;
  const trail = points.length > 0
    ? `<polyline points="${points.map((n) => `${n!.lon},${fy(n!.lat!)}`).join(" ")}"/>` +
      points.map((n) =>
        `<g class="hop"><circle cx="${n!.lon}" cy="${fy(n!.lat!)}" r="0.002"/>` +
        (n!.name
          ? `<text class="hoplabel" x="${n!.lon}" y="${fy(n!.lat!) + 0.0035}" text-anchor="middle">${esc(n!.name)}</text>`
          : "") +
        `</g>`).join("") +
      fx.pulse
    : "";
  // Adaptive zoom (Brett 2026-09-18): a tiny route must not blow up
  // to full screen, a big one must still fit. The view never shows
  // less than MIN_SPAN degrees across; bigger routes get 25% breathing
  // room. svg width is ~670px on desktop, so MIN_SPAN ≈ 100 m/px.
  const MIN_SPAN = 0.06;
  const rawW = points.length > 0
    ? Math.max(...lons) - Math.min(...lons)
    : 0;
  const rawH = points.length > 0
    ? Math.max(...lats) - Math.min(...lats)
    : 0;
  const span = Math.max(MIN_SPAN, rawW * 1.25, rawH * 1.25);
  const midLon = points.length > 0
    ? (Math.min(...lons) + Math.max(...lons)) / 2 : -122.6;
  const midLat = points.length > 0
    ? (Math.min(...lats) + Math.max(...lats)) / 2 : 38.08;
  const vb = points.length > 0
    ? `${midLon - span / 2} ${midLat - span / 2} ${span} ${span}`
    : "-0.3 -0.3 0.6 0.6";
  const notes: string[] = [];
  if (missing > 0) notes.push(
    `${missing} node(s) without position data are not drawn.`);
  if (hiddenByFilter > 0) notes.push(
    `${hiddenByFilter} companion hop(s) hidden by the repeaters-only view.`);
  // Heading uses the SAME human label as the section-screen button
  // (Brett 2026-09-18): node name arrow node name, never bare hex.
  const hops = visible
    .map((p) => state.nodes.get(p)?.name ?? null);
  const headingLabel = hops.some((h) => h)
    ? routeDisplayName(hops)
    : route.routeId.toString(16);
  return `<div class="card"><h3>Route ${headingLabel}
    <span class="muted">(section ${route.sectionId})</span></h3>
    <p>${route.packetCount} packets, median delay ${fmtDelay(route.delayMedS)} (est.),
    last heard ${route.lastHeardMin ?? "?"} min ago.
    <span class="aging aging-${fx.state}">${AGING_LABEL[fx.state]}</span></p>
    <svg id="trail" viewBox="${vb}" class="${fx.cls}">${trail}</svg>
    ${notes.map((t) => `<p class="muted">${t}</p>`).join("")}
    <button id="refresh-route" class="primary">Request route refresh</button>
    <button id="back">Back</button>
  </div>`;
}

let selectedSection: number | null = null;
let selectedRoute: number | null = null;
let repeatersOnly = false;   // view filter: hide companion-class nodes
let showSectionNumbers = true; // map numerals toggle (Brett 2026-09-18)

function render(): void {
  el<HTMLDivElement>("app-inner").innerHTML = `
    ${renderFeedHealth()}
    ${selectedRoute != null && state.routes.has(selectedRoute)
      ? renderGhostTrail(state.routes.get(selectedRoute)!)
      : selectedSection != null
        ? renderSectionDetail(selectedSection)
        : renderMap()}
  `;
  // A live packet for the on-screen route just landed: replay the
  // moving dot once (then remove it - no ambient animation).
  if (routeUpdateFlash != null && selectedRoute === routeUpdateFlash) {
    routeUpdateFlash = null;
    const route = state.routes.get(selectedRoute);
    const svg = el<HTMLDivElement>("app-inner").querySelector<SVGSVGElement>("svg#trail");
    if (route && svg) {
      const pts = route.prefixes
        .map((p) => state.nodes.get(p))
        .filter((n) => n && n.lat != null && n.lon != null);
      if (pts.length >= 2) {
        startTrailPulse(svg, trailFx({
          points: pts.map((n) => ({ lon: n!.lon!, lat: n!.lat! })),
          lastHeardMin: route.lastHeardMin,
          play: true,
        }));
      }
    }
  }
  // wire buttons
  el<HTMLDivElement>("app-inner").querySelectorAll(".areamap .cell")
    .forEach((c) => c.addEventListener("click", () => {
      selectedSection = Number((c as HTMLElement).dataset.section);
      selectedRoute = null;
      render();
    }));
  el<HTMLDivElement>("app-inner").querySelectorAll("button.route")
    .forEach((b) => b.addEventListener("click", () => {
      selectedRoute = Number((b as HTMLElement).dataset.route);
      render();
      const rid = selectedRoute;
      const sect = (b as HTMLElement).dataset.section;
      if (rid != null && !state.routes.has(rid) && sect != null) {
        sendRefresh(REFRESH_KIND_ROUTE, rid);
      }
    }));
  const inner = el<HTMLDivElement>("app-inner");
  inner.querySelector("#filter-repeaters")?.addEventListener("change", (e) => {
    repeatersOnly = (e.target as HTMLInputElement).checked;
    render();
  });
  inner.querySelector("#show-section-numbers")?.addEventListener("change", (e) => {
    showSectionNumbers = (e.target as HTMLInputElement).checked;
    render();
  });
  // Collapsible Feed health: the whole title row is the tap target.
  inner.querySelector("#fh-toggle")?.addEventListener("click", () => {
    feedHealthOpen = !feedHealthOpen;
    render();
  });
  inner.querySelector("button#back")?.addEventListener("click", () => {
    if (selectedRoute != null) selectedRoute = null;
    else selectedSection = null;
    render();
  });
  inner.querySelector("button#refresh-section")?.addEventListener("click", () => {
    if (selectedSection != null) sendRefresh(REFRESH_KIND_SECTION, selectedSection);
  });
  inner.querySelector("button#refresh-route")?.addEventListener("click", () => {
    if (selectedRoute != null) sendRefresh(REFRESH_KIND_ROUTE, selectedRoute);
  });
  // Map refresh now lives ON the map card (Brett 2026-09-22) - the
  // card re-renders, so the wiring rides here (optional-chain: also
  // absent on the section-detail view).
  inner.querySelector("button#refresh-map")?.addEventListener("click", () => {
    sendRefresh(REFRESH_KIND_SECTION, REFRESH_WHOLE_AREA);
  });
  // Route-row hover -> reveal that route's ghost path on the map
  // (same as the demo bench; a no-op on touch screens).
  inner.querySelectorAll("button.route[data-hover]").forEach((b) => {
    const rid = (b as HTMLElement).dataset.hover;
    const ghost = inner.querySelector(`.route-ghost[data-for="${rid}"]`);
    b.addEventListener("mouseenter", () => ghost?.classList.add("show"));
    b.addEventListener("mouseleave", () => ghost?.classList.remove("show"));
  });
}

// ---------------------------------------------------------------- boot

export function boot(): void {
  el<HTMLButtonElement>("connect").addEventListener("click", onConnect);
  // DIRECT mode switch (bench): one source at a time, chosen here.
  el<HTMLSelectElement>("source-mode").addEventListener("change", async (e) => {
    const mode = (e.target as HTMLSelectElement).value as "radio" | "direct";
    if (mode === sourceMode) return;
    // Switching sources drops the old link first - never two feeds.
    if (sourceMode === "direct") direct.disconnect();
    else await client.disconnect();
    sourceMode = mode;
    syncConnectButton(false, false);   // fresh mode: nothing connected
    el<HTMLInputElement>("radio-name").disabled = mode === "direct";
    // SELF-CONTAINED RULE: direct mode takes a host address + data-door
    // password (feed data crosses the network; pages stay home).
    el<HTMLDivElement>("node-link-row").hidden = mode !== "direct";
    try {
      const savedHost = localStorage.getItem("node-host") || "";
      if (savedHost) {
        (el<HTMLInputElement>("node-host") as HTMLInputElement).value = savedHost;
      }
      // Remember the password VISIBLELY (Brett, 2026-09-21): prefill
      // the saved one so he never re-types it; a fresh paste simply
      // overwrites it. type=password dots hide it from shoulders.
      const savedToken = localStorage.getItem("node-token") || "";
      if (savedToken) {
        (el<HTMLInputElement>("node-token") as HTMLInputElement).value =
          savedToken;
        el<HTMLInputElement>("node-token").placeholder =
          "saved - type over to replace";
      }
    } catch { /* localStorage unavailable: fresh type each time */ }
    logLine(`source switched: ${mode} mode`);
    render();
  });
  render();
  logLine("Scope client ready. BLE: connect a #scope companion radio. " +
    "TCP: connect meshtech-node (no radio needed).");
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", boot);
}
