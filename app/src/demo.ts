/**
 * Demo entry - bundled to plain JS (dist/demo.js) alongside the real
 * app. Plays synthetic PROTOCOL.md-shaped packets through the SAME
 * ScopeState the live app uses, then renders. Nothing here touches a
 * radio; the banner marks everything as synthetic.
 */
import "./style.css";
import { ScopeState } from "./lib/state.ts";
import { REFRESH_KIND_SECTION, encodeRefreshReq } from "./lib/codec.ts";
import { esc } from "./lib/esc.ts";
import { trailFx, startTrailPulse, AGING_LABEL } from "./lib/trailfx.ts";
import { areaMapSvg, sectionMapSvg } from "./lib/areamap.ts";
import { routeDisplayName } from "./lib/routes.ts";

const state = new ScopeState();

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function fmtDelay(seconds: number | null): string {
  if (seconds == null) return "n/a";
  return seconds >= 90 ? `${Math.round(seconds / 60)} min` : `${seconds}s`;
}

/**
 * Route rows show node names joined by GRAPHICAL arrows (Brett:
 * nobody memorizes hex). The shared helper lives in lib/routes.ts;
 * this glue maps wire hop ids to node names.
 */
function routeLabel(rid: number): string {
  const r = state.routes.get(rid);
  if (!r || r.prefixes.length === 0) return "unnamed route";
  return routeDisplayName(r.prefixes.map((p) => state.nodes.get(p)?.name));
}

// Area: 94945 / Novato CA (Brett's home grid), matching the host
// demo's config default. Everything stays synthetic - honest demo.
// ---- Host A (origin 0xb17e, "hilltop") - the primary demo host ----
state.apply({ kind: "layout", seq: 1, origin: 0xb17e, grid: 3,
  centerLat: 38.1074, centerLon: -122.5697, spanM: 40000,
  name: "Novato / 94945 (synthetic)" });
state.apply({ kind: "pulse", seq: 2, origin: 0xb17e, uptimeMin: 90,
  rxPerHour: 214, feedAirtimeSPerH: 3, activeTotal: 31,
  sectionCounts: [4, 2, 6, 1, 9, 3, 2, 1, 3] });
state.apply({ kind: "sect_sum", seq: 3, origin: 0xb17e, sectionId: 5,
  activeNodes: 9, packetCount: 126, delayP50S: 48, delayP90S: 816,
  routeStubs: [0x0221, 0xabcd] });
state.apply({ kind: "route", seq: 4, origin: 0xb17e, sectionId: 5,
  routeId: 0x0221, packetCount: 56, delayMedS: 4, lastHeardMin: 4,
  prefixes: [0x11, 0x22, 0x33] });
// A second route in the "overdue" aging state (4 h silent): shows the
// dashed/dimmed treatment and no pulse, next to route 0x0221's live one.
state.apply({ kind: "route", seq: 9, origin: 0xb17e, sectionId: 5,
  routeId: 0xabcd, packetCount: 12, delayMedS: 9, lastHeardMin: 240,
  prefixes: [0x11, 0x44] });
state.apply({ kind: "intro", seq: 5, origin: 0xb17e, entries: [
  { prefix: 0x11, name: "Hilltop", lat: 38.0945, lon: -122.5757,
    nodeClass: 1 },
  { prefix: 0x22, name: "Hamilton", lat: 38.1087, lon: -122.5237,
    nodeClass: 1 },
  { prefix: 0x33, name: "Bel Marin", lat: 38.1187, lon: -122.5176,
    nodeClass: 2 },
  { prefix: 0x44, name: "Ignacio", lat: 38.0776, lon: -122.5446 },
], centerLat: 38.1074, centerLon: -122.5697, spanM: 40000 });

// ---- Host B (origin 0x0a11, overlapping to the west) - proves the
// multi-host client path: separate layout, health and sections ----
state.apply({ kind: "layout", seq: 6, origin: 0x0a11, grid: 3,
  centerLat: 38.1074, centerLon: -122.6697, spanM: 40000,
  name: "West ridge (synthetic)" });
state.apply({ kind: "pulse", seq: 7, origin: 0x0a11, uptimeMin: 45,
  rxPerHour: 96, feedAirtimeSPerH: 2, activeTotal: 12,
  sectionCounts: [1, 0, 0, 3, 5, 1, 0, 2, 0] });
state.apply({ kind: "sect_sum", seq: 8, origin: 0x0a11, sectionId: 5,
  activeNodes: 5, packetCount: 38, delayP50S: 61, delayP90S: 900,
  routeStubs: [] });

let selectedSection: number | null = null;
let selectedRoute: number | null = null;
let selectedSect: SectSum | null = null;
let selectedRt = state.routes.get(0x0221) || null;
let repeatersOnly = false;
let showSectionNumbers = true;

function render(): void {
  const h = state.health;
  const inner = el<HTMLDivElement>("app-inner");
  if (selectedRoute != null && selectedRt) {
    const visible = selectedRt.prefixes.filter((p) => {
      const n = state.nodes.get(p);
      return !(repeatersOnly && (n?.nodeClass ?? 0) === 2);
    });
    const hiddenHops = selectedRt.prefixes.length - visible.length;
    const pts = visible
      .map((p) => state.nodes.get(p))
      .filter((n) => n && n.lat != null && n.lon != null);
    const hiddenNote = hiddenHops > 0
      ? `<p class="muted">${hiddenHops} companion hop(s) hidden by the repeaters-only view.</p>`
      : "";
    // Trail effects (TODOS #16): aging class. NO looped dot on open -
    // the demo replays one pass when a route packet arrives, exactly
    // like the live app ("Simulate arrival" button stands in for the
    // radio, since the demo has no live feed).
    const fx = trailFx({
      points: pts.map((n) => ({ lon: n!.lon!, lat: n!.lat! })),
      lastHeardMin: selectedRt.lastHeardMin,
    });
    const lons = pts.map((n) => n!.lon!);
    const lats = pts.map((n) => n!.lat!);
    // NORTH IS UP: reflect lat inside the viewBox (SVG y grows down),
    // same convention the area map pins. Also: small hop labels.
    const minLat = pts.length > 0 ? Math.min(...lats) : 0;
    const maxLat = pts.length > 0 ? Math.max(...lats) : 0;
    const fy = (lat: number): number => maxLat + minLat - lat;
    // Adaptive zoom (Brett 2026-09-18): same formula as the live app -
    // never show less than MIN_SPAN degrees across; bigger routes get
    // 25% breathing room. Keeps small routes from looking huge.
    const MIN_SPAN = 0.06;
    const rawW = pts.length > 0 ? Math.max(...lons) - Math.min(...lons) : 0;
    const rawH = pts.length > 0 ? Math.max(...lats) - Math.min(...lats) : 0;
    const span = Math.max(MIN_SPAN, rawW * 1.25, rawH * 1.25);
    const midLon = pts.length > 0
      ? (Math.min(...lons) + Math.max(...lons)) / 2 : -122.6;
    const midLat = pts.length > 0
      ? (Math.min(...lats) + Math.max(...lats)) / 2 : 38.08;
    const vb = pts.length > 0
      ? `${midLon - span / 2} ${midLat - span / 2} ${span} ${span}`
      : "-122.60 38.06 0.12 0.09";
    inner.innerHTML = `
      <div class="card"><h3>Route ${routeLabel(selectedRoute!)}
        <span class="rmuted">(section ${selectedRt.sectionId})</span></h3>
        <p>${selectedRt.packetCount} packets, median delay ${fmtDelay(selectedRt.delayMedS)} (est.),
        last heard ${selectedRt.lastHeardMin} min ago.</p>
        <svg class="${fx.cls}" viewBox="${vb}">
          <polyline points="${pts.map((n) => `${n!.lon},${fy(n!.lat!)}`).join(" ")}"/>
          ${pts.map((n) =>
            `<g class="hop"><circle cx="${n!.lon}" cy="${fy(n!.lat!)}" r="0.002"/>` +
            (n!.name
              ? `<text class="hoplabel" x="${n!.lon}" y="${fy(n!.lat!) + 0.0035}" text-anchor="middle">${esc(n!.name)}</text>`
              : "") +
            `</g>`).join("")}
          ${fx.pulse}
        </svg>
        <p class="muted">Ghost trail: ${
          routeDisplayName(pts.map((n) => n!.name))
        } <span class="aging aging-${fx.state}">${AGING_LABEL[fx.state]}</span></p>
        ${hiddenNote}
        <button id="simulate-arrival">Simulate arrival</button>
        <button id="back">Back</button>
      </div>`;
  } else if (selectedSection != null && selectedSect) {
    const r = state.geometry!.section(selectedSection);
    const mapBlock = sectionMapSvg({
      sectionId: selectedSection,
      west: r.west, south: r.south, east: r.east, north: r.north,
      squareWest: state.geometry!.west,
      squareSouth: state.geometry!.south,
      squareSpan: state.geometry!.spanDeg,
      nodes: [...state.nodes.values()],
      hoverRoutes: selectedSect.routeStubs
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
    inner.innerHTML = `
      <div class="card"><h3>Section ${selectedSect.sectionId}</h3>
        ${mapBlock}
        <div class="statgrid">
          <div><span class="big">${selectedSect.activeNodes}</span>active nodes</div>
          <div><span class="big">${selectedSect.packetCount}</span>packets</div>
          <div><span class="big">${fmtDelay(selectedSect.delayP50S)}</span>delay p50 (est.)</div>
          <div><span class="big">${fmtDelay(selectedSect.delayP90S)}</span>delay p90 (est.)</div>
        </div>
        <div class="routes">
          ${selectedSect.routeStubs.map((rid, i) => {
            const r = state.routes.get(rid);
            return `<button class="route" data-route="${rid}" data-hover="${rid}">
              <span class="rname">Route ${i + 1} - ${routeLabel(rid)}</span>
              <span class="rmuted">${r ? `${r.packetCount} pkts, ${fmtDelay(r.delayMedS)} (est.)` : "detail not loaded"}</span>
            </button>`;
          }).join("")}
        </div>
        <button class="primary" id="refresh-section">Request section refresh</button>
        <button id="back">Back to map</button>
      </div>`;
  } else {
    const { hidden } = state.filteredNodes(repeatersOnly);
    const filterNote = repeatersOnly && hidden > 0
      ? `<p class="muted">${hidden} companion node(s) hidden. Nodes the
        host has not classified always stay visible.</p>`
      : "";
    inner.innerHTML = `
      <div class="card"><h3>Feed health</h3>
        <div class="statgrid">
          <div><span class="big">${h.activeTotal}</span>active nodes</div>
          <div><span class="big">${h.rxPerHour}</span>mesh RX/hour</div>
          <div><span class="big">${h.feedAirtimeSPerH}s</span>feed TX/hour (est.)</div>
          <div><span class="big">just now</span>last pulse</div>
        </div></div>
      <div class="card"><h3>${state.layout?.name} (${state.geometry?.grid}x${state.geometry?.grid})</h3>
        <div class="statgrid">
          <div><span class="big">${state.hosts().length}</span>scope hosts heard</div>
          <div><span class="big">${state.hosts().filter((h) => h.origin !== state.primaryOrigin).length}</span>peer hosts</div>
        </div>
        <label class="filter"><input type="checkbox" id="filter-repeaters"
          ${repeatersOnly ? "checked" : ""}/> Repeaters only</label>
        <label class="filter"><input type="checkbox" id="show-section-numbers"
          ${showSectionNumbers ? "checked" : ""}/> Section numbers</label>
        ${areaMapSvg({
          grid: state.geometry!.grid,
          west: state.geometry!.west,
          south: state.geometry!.south,
          spanDeg: state.geometry!.spanDeg,
          counts: h.sectionCounts ?? [],
          nodes: [...state.nodes.values()],
          showSectionNumbers,
        })}
        ${filterNote}
        <p class="muted">Corner number = active nodes the host heard in
        that section. Dots = nodes that published a position (fewer is
        normal). Select a section - in the live app this sends a
        REFRESH_REQ (one GRP_DATA packet), the only uplink a client makes.</p>
      </div>`;
  }

  // Route hover: light the matching ghost path on the section map.
  inner.querySelectorAll("button.route[data-hover]").forEach((b) => {
    const rid = (b as HTMLElement).dataset.hover;
    const ghost = inner.querySelector(`.route-ghost[data-for="${rid}"]`);
    b.addEventListener("mouseenter", () => ghost?.classList.add("show"));
    b.addEventListener("mouseleave", () => ghost?.classList.remove("show"));
  });

  inner.querySelectorAll(".areamap .cell").forEach((c) =>
    c.addEventListener("click", () => {
      selectedSection = Number((c as HTMLElement).dataset.section);
      selectedSect = state.sections.get(selectedSection) || null;
      selectedRoute = null;
      render();
    }));
  inner.querySelectorAll("button.route").forEach((b) =>
    b.addEventListener("click", () => {
      selectedRoute = Number((b as HTMLElement).dataset.route);
      selectedRt = state.routes.get(selectedRoute) || null;
      render();
    }));
  inner.querySelector("#filter-repeaters")?.addEventListener("change", (e) => {
    repeatersOnly = (e.target as HTMLInputElement).checked;
    render();
  });
  inner.querySelector("#show-section-numbers")?.addEventListener("change", (e) => {
    showSectionNumbers = (e.target as HTMLInputElement).checked;
    render();
  });
  // Demo stand-in for a live packet: replays the moving dot ONCE,
  // then the trail goes still again (matches the live app).
  inner.querySelector("button#simulate-arrival")?.addEventListener("click", () => {
    if (selectedRoute == null || !selectedRt) return;
    const svg = inner.querySelector<SVGSVGElement>("svg.trail");
    if (!svg) return;
    const vis = selectedRt.prefixes
      .map((p) => state.nodes.get(p))
      .filter((n) => n && n.lat != null && n.lon != null);
    if (vis.length < 2) return;
    startTrailPulse(svg, trailFx({
      points: vis.map((n) => ({ lon: n!.lon!, lat: n!.lat! })),
      lastHeardMin: selectedRt.lastHeardMin,
      play: true,
    }));
  });
  const backBtn =  inner.querySelector("button#back");
  backBtn?.addEventListener("click", () => {
    if (selectedRoute != null) selectedRoute = null;
    else { selectedSection = null; selectedSect = null; }
    render();
  });
  const refreshBtn = inner.querySelector("button#refresh-section");
  refreshBtn?.addEventListener("click", () => {
    if (selectedSection == null) return;
    const nonce = Math.floor(Math.random() * 0xffff) + 1;
    const bytes = encodeRefreshReq({ seq: nonce,
      refreshKind: REFRESH_KIND_SECTION, target: selectedSection, nonce });
    logLine(`demo: REFRESH_REQ built (${bytes.length}B, not transmitted)`);
  });

  function logLine(line: string): void {
    const log = el<HTMLDivElement>("log");
    if (!log) return;
    const div = document.createElement("div");
    div.textContent = line;
    log.prepend(div);
  }
}

document.addEventListener("DOMContentLoaded", render);
