/**
 * Client state: the scope picture built from feed packets.
 *
 * The client is receive-only except REFRESH_REQ uplinks. Everything
 * here is derived from what the host actually sent - no fabrication
 * (honesty rule): delays stay "unknown" when the host sent 0, nodes
 * without positions are counted but never drawn on the map.
 *
 * v1.1 multi-host: packets carry the sending host's origin. Everything
 * is stored per-origin; the PRIMARY host (first one heard, or the one
 * whose packets arrive most) keeps the original single-host maps so
 * the existing UI keeps working. `hosts()` exposes every host heard
 * (origin -> layout/health/last-heard) for the multi-area view. A host
 * not heard for HOST_STALE_MS is flagged stale, mirroring the hosts'
 * own 3-missed-beacon expiry.
 */

import { GridGeometry, type SectionRect } from "./grid.ts";
import {
  NODE_CLASS_COMPANION,
  type Intro, type Layout, type Pulse, type Route, type ScopePacket,
  type SectSum, type Snap,
} from "./codec.ts";

/** Client-side staleness for hosts (>= 3 missed 10-min beacons). */
export const HOST_STALE_MS = 32 * 60 * 1000;

export interface NodeInfo {
  prefix: number;
  name?: string | null;
  lat?: number | null;
  lon?: number | null;
  nodeClass?: number | null;   // INTRO flags bits 2-3; 0/absent = unknown
  lastIntroTs?: number;
}

export interface RouteInfo {
  sectionId: number;
  routeId: number;
  origin?: number;
  packetCount: number;
  delayMedS: number | null;    // null = unknown (host sent 0)
  lastHeardMin: number | null;
  prefixes: number[];
  updatedAt: number;
}

export interface SectionInfo {
  sectionId: number;
  origin?: number;
  activeNodes: number | null;
  packetCount: number | null;
  delayP50S: number | null;
  delayP90S: number | null;
  routeStubs: number[];
  updatedAt: number;
}

export interface FeedHealth {
  lastPulseTs: number | null;
  rxPerHour: number | null;
  feedAirtimeSPerH: number | null;
  activeTotal: number | null;
  sectionCounts: number[] | null;
  hostUptimeMin: number | null;
}

export interface HostEntry {
  origin: number;              // 0 = anonymous / v1 packet
  layout: Layout;
  health: FeedHealth | null;
  lastHeardTs: number;
  stale: boolean;
}

function emptyHealth(): FeedHealth {
  return {
    lastPulseTs: null, rxPerHour: null, feedAirtimeSPerH: null,
    activeTotal: null, sectionCounts: null, hostUptimeMin: null,
  };
}

export class ScopeState {
  layout: Layout | null = null;
  geometry: GridGeometry | null = null;
  nodes = new Map<number, NodeInfo>();
  sections = new Map<number, SectionInfo>();
  routes = new Map<number, RouteInfo>();
  health: FeedHealth = emptyHealth();
  snapParts = new Map<number, Uint8Array>();   // part -> body
  snapMeta: { id: number; parts: number } | null = null;

  // ---- v1.1 per-host storage --------------------------------------
  /** First host heard becomes primary; its data fills the maps above. */
  primaryOrigin: number | null = null;
  layoutsByOrigin = new Map<number, { layout: Layout; ts: number }>();
  healthByOrigin = new Map<number, FeedHealth>();
  sectionsByOrigin = new Map<number, Map<number, SectionInfo>>();
  routesByOrigin = new Map<number, Map<number, RouteInfo>>();

  apply(packet: ScopePacket): string {
    switch (packet.kind) {
      case "layout": return this.applyLayout(packet);
      case "pulse": return this.applyPulse(packet);
      case "sect_sum": return this.applySectSum(packet);
      case "route": return this.applyRoute(packet);
      case "intro": return this.applyIntro(packet);
      case "snap": return this.applySnap(packet);
      default: return "ignored";
    }
  }

  private originOf(o: { origin?: number }): number {
    return o.origin ?? 0;
  }

  private isPrimary(origin: number): boolean {
    return this.primaryOrigin === null || this.primaryOrigin === origin;
  }

  private applyLayout(l: Layout): string {
    const origin = this.originOf(l);
    this.layoutsByOrigin.set(origin, { layout: l, ts: Date.now() });
    if (!this.isPrimary(origin)) return "layout (peer)";
    if (this.primaryOrigin === null) this.primaryOrigin = origin;
    this.layout = l;
    this.geometry = new GridGeometry(l.grid, l.centerLat, l.centerLon, l.spanM);
    return "layout";
  }

  private applyPulse(p: Pulse): string {
    const origin = this.originOf(p);
    const health: FeedHealth = {
      lastPulseTs: Date.now(),
      rxPerHour: p.rxPerHour,
      feedAirtimeSPerH: p.feedAirtimeSPerH,
      activeTotal: p.activeTotal,
      sectionCounts: [...p.sectionCounts],
      hostUptimeMin: p.uptimeMin,
    };
    this.healthByOrigin.set(origin, health);
    if (!this.isPrimary(origin)) return "pulse (peer)";
    if (this.primaryOrigin === null) this.primaryOrigin = origin;
    this.health = health;
    return "pulse";
  }

  private applySectSum(s: SectSum): string {
    const origin = this.originOf(s);
    const info: SectionInfo = {
      sectionId: s.sectionId,
      origin,
      activeNodes: s.activeNodes,
      packetCount: s.packetCount,
      delayP50S: s.delayP50S > 0 ? s.delayP50S : null,
      delayP90S: s.delayP90S > 0 ? s.delayP90S : null,
      routeStubs: [...s.routeStubs],
      updatedAt: Date.now(),
    };
    let byOrigin = this.sectionsByOrigin.get(origin);
    if (!byOrigin) {
      byOrigin = new Map();
      this.sectionsByOrigin.set(origin, byOrigin);
    }
    byOrigin.set(s.sectionId, info);
    if (!this.isPrimary(origin)) return "sect_sum (peer)";
    if (this.primaryOrigin === null) this.primaryOrigin = origin;
    this.sections.set(s.sectionId, info);
    return "sect_sum";
  }

  private applyRoute(r: Route): string {
    const origin = this.originOf(r);
    const info: RouteInfo = {
      sectionId: r.sectionId,
      routeId: r.routeId,
      origin,
      packetCount: r.packetCount,
      delayMedS: r.delayMedS > 0 ? r.delayMedS : null,
      lastHeardMin: r.lastHeardMin,
      prefixes: [...r.prefixes],
      updatedAt: Date.now(),
    };
    let byOrigin = this.routesByOrigin.get(origin);
    if (!byOrigin) {
      byOrigin = new Map();
      this.routesByOrigin.set(origin, byOrigin);
    }
    byOrigin.set(r.routeId, info);
    if (!this.isPrimary(origin)) return "route (peer)";
    if (this.primaryOrigin === null) this.primaryOrigin = origin;
    this.routes.set(r.routeId, info);
    return "route";
  }

  private applyIntro(i: Intro): string {
    // THE 2026-09-22 ZERO-DOTS BUG, fixed here: an INTRO's positions
    // ride the wire as DELTAS from the host's LAYOUT center (airtime
    // economy - 4 bytes per node instead of 8). decodeIntro() decodes
    // against the LAYOUT the client already holds. The old live path
    // decoded against center (0,0): every positioned dot landed
    // ~10,000 km off-map (near lat 0) - stats filled, map never drew.
    // The demo masked it by hand-feeding true coordinates.
    const geo = this.geometry;
    for (const e of i.entries) {
      const existing = this.nodes.get(e.prefix) || { prefix: e.prefix };
      existing.name = e.name ?? existing.name;
      let lat = e.lat;
      let lon = e.lon;
      if (lat != null && lon != null && geo != null &&
          !i.centerLat && !i.centerLon) {
        // Decoded WITHOUT the layout center (center 0): the decode is
        // linear, so true = decoded + center. Exact, lossless.
        lat += geo.centerLat;
        lon += geo.centerLon;
      }
      existing.lat = lat ?? existing.lat;
      existing.lon = lon ?? existing.lon;
      // class: only overwrite when the packet carries a real one
      if ((e.nodeClass ?? 0) !== 0) existing.nodeClass = e.nodeClass;
      existing.lastIntroTs = Date.now();
      this.nodes.set(e.prefix, existing);
    }
    return "intro";
  }

  private applySnap(s: Snap): string {
    if (this.snapMeta?.id !== s.snapId) {
      this.snapParts.clear();
      this.snapMeta = { id: s.snapId, parts: s.parts };
    }
    this.snapParts.set(s.part, s.body);
    return `snap ${this.snapParts.size}/${s.parts}`;
  }

  /** Every host heard (origin -> layout/health/last-heard), stale flagged. */
  hosts(): HostEntry[] {
    const now = Date.now();
    const out: HostEntry[] = [];
    for (const [origin, entry] of this.layoutsByOrigin) {
      out.push({
        origin,
        layout: entry.layout,
        health: this.healthByOrigin.get(origin) ?? null,
        lastHeardTs: entry.ts,
        stale: now - entry.ts > HOST_STALE_MS,
      });
    }
    // A host whose PULSEs arrive but whose LAYOUT is pending still shows.
    for (const origin of this.healthByOrigin.keys()) {
      if (!this.layoutsByOrigin.has(origin)) {
        const health = this.healthByOrigin.get(origin)!;
        out.push({
          origin,
          layout: null as unknown as Layout,
          health,
          lastHeardTs: health.lastPulseTs ?? now,
          stale: now - (health.lastPulseTs ?? now) > HOST_STALE_MS,
        });
      }
    }
    return out.sort((a, b) => a.origin - b.origin);
  }

  /**
   * DIRECT mode: the node restarted (seq regressed), so everything we
   * hold is stale by definition - drop it. The node serves a fresh
   * LAYOUT right after restart, so the map redraws in seconds.
   */
  resetAll(): void {
    this.layout = null;
    this.geometry = null;
    this.nodes.clear();
    this.sections.clear();
    this.routes.clear();
    this.health = emptyHealth();
    this.snapParts.clear();
    this.snapMeta = null;
    this.primaryOrigin = null;
    this.layoutsByOrigin.clear();
    this.healthByOrigin.clear();
    this.sectionsByOrigin.clear();
    this.routesByOrigin.clear();
  }

  sectionRects(): SectionRect[] {
    if (!this.geometry) return [];
    const out: SectionRect[] = [];
    // v1.2: ids 1..N (0 is reserved, never a square).
    for (let i = 1; i <= this.geometry.sectionCount; i++) {
      out.push(this.geometry.section(i));
    }
    return out;
  }

  positionedNodes(): NodeInfo[] {
    return [...this.nodes.values()].filter(
      (n) => n.lat != null && n.lon != null);
  }

  /**
   * Class-filter view of known nodes.
   * repeatersOnly=true keeps repeaters AND unknown-class nodes: the
   * host publishes class only when its source data knows it, so
   * hiding unknowns would silently drop real repeaters (dishonest).
   * Returns the kept nodes plus an honest count of what was hidden.
   */
  filteredNodes(repeatersOnly: boolean): {
    kept: NodeInfo[]; hidden: number;
  } {
    const all = [...this.nodes.values()];
    if (!repeatersOnly) return { kept: all, hidden: 0 };
    const kept = all.filter(
      (n) => (n.nodeClass ?? 0) !== NODE_CLASS_COMPANION);
    return { kept, hidden: all.length - kept.length };
  }
}
