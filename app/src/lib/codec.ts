/**
 * Wire codec for the scope feed protocol v1.1.
 *
 * TypeScript port of meshtech-scope/src/meshtech_scope/core/codec.py.
 * Both implement PROTOCOL.md exactly and must pass the SAME golden
 * vectors (see codec.test.ts and meshtech-scope/tests/golden_vectors.json).
 * Any wire change happens in PROTOCOL.md first, bumps PROTO_VERSION
 * (v1.3, 2026-09-23, MAP-SIZE-DESIGN.md: REFRESH_REQ + span_km),
 * and regenerates the vectors on both sides.
 *
 * All multi-byte integers are little-endian (MeshCore convention).
 */

export const PROTO_VERSION = 0x05;

// v1.2 (2026-09-20): SECTION IDS ARE 1-BASED (1 = NW .. 9 = SE, matching
// what the UI prints). 0 is RESERVED: in a REFRESH_REQ target it means
// "whole-area"; a SECT_SUM/ROUTE with section_id 0 is malformed.
export const REFRESH_WHOLE_AREA = 0;

export const TYPE_PULSE = 0x5301;
export const TYPE_SECT_SUM = 0x5302;
export const TYPE_ROUTE = 0x5303;
export const TYPE_INTRO = 0x5304;
export const TYPE_LAYOUT = 0x5305;
export const TYPE_SNAP = 0x5306;
export const TYPE_REFRESH_REQ = 0x5311;

export const TYPE_NAMES: Record<number, string> = {
  [TYPE_PULSE]: "PULSE",
  [TYPE_SECT_SUM]: "SECT_SUM",
  [TYPE_ROUTE]: "ROUTE",
  [TYPE_INTRO]: "INTRO",
  [TYPE_LAYOUT]: "LAYOUT",
  [TYPE_SNAP]: "SNAP",
  [TYPE_REFRESH_REQ]: "REFRESH_REQ",
};

export const MAX_CHANNEL_DATA = 163;
export const TARGET_PAYLOAD = 120;
export const MAX_NAME = 31;

export const REFRESH_KIND_SECTION = 1;
export const REFRESH_KIND_ROUTE = 2;
/** "owner decides" (v1.1 multi-host election). */
export const REFRESH_HOST_ANY = 0x0000;

/** INTRO flags bits 2-3: node class (v1.1). 0 = unknown (honest default
 *  when the host's source data does not classify nodes). */
export const NODE_CLASS_UNKNOWN = 0x00;
export const NODE_CLASS_REPEATER = 0x01;
export const NODE_CLASS_COMPANION = 0x02;
export const NODE_CLASS_RESERVED = 0x03;
export const NODE_CLASS_SHIFT = 2;
export const NODE_CLASS_MASK = 0x03;

export class CodecError extends Error {}

// --------------------------------------------------------------- helpers

function u8(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff)
    throw new CodecError(`${what} out of range: ${value}`);
  return value;
}

function u16(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff)
    throw new CodecError(`${what} out of range: ${value}`);
  return value;
}

function packHeader(seq: number, origin = 0): Uint8Array {
  // v1.1: version(1) + seq(2 LE) + origin(2 LE)
  const b = new Uint8Array(5);
  b[0] = PROTO_VERSION;
  b[1] = u16(seq, "seq") & 0xff;
  b[2] = (u16(seq, "seq") >> 8) & 0xff;
  b[3] = u16(origin, "origin") & 0xff;
  b[4] = (u16(origin, "origin") >> 8) & 0xff;
  return b;
}

export interface Header {
  version: number;
  seq: number;
  origin: number;
}

function unpackHeader(p: Uint8Array, off: number): [Header, number] {
  if (p.length < off + 3) throw new CodecError("payload too short for header");
  const version = p[off];
  if (version === 0x01) {
    // v1 packet: 3-byte header, no origin field (origin = 0).
    return [{ version, seq: p[off + 1] | (p[off + 2] << 8), origin: 0 },
            off + 3];
  }
  // STRICT like the Python codec: an unknown version must not be read
  // with guessed field widths - a loud error beats a confident misread.
  if (version !== 0x02 && version !== 0x03 && version !== 0x04 &&
      version !== 0x05)
    throw new CodecError(`unsupported protocol version 0x${version.toString(16).padStart(2, "0")}`);
  if (p.length < off + 5) throw new CodecError("payload too short for v1.1 header");
  return [{ version, seq: p[off + 1] | (p[off + 2] << 8),
            origin: p[off + 3] | (p[off + 4] << 8) }, off + 5];
}

/** Full GRP_DATA plaintext: data_type(2 LE) + data_len(1) + body. */
function dataBytes(dataType: number, body: Uint8Array): Uint8Array {
  if (body.length > 255) throw new CodecError(`body too long: ${body.length}`);
  const out = new Uint8Array(3 + body.length);
  out[0] = dataType & 0xff;
  out[1] = (dataType >> 8) & 0xff;
  out[2] = body.length;
  out.set(body, 3);
  return out;
}

export function peekDataType(p: Uint8Array): number {
  if (p.length < 3) throw new CodecError("payload too short for data_type");
  return p[0] | (p[1] << 8);
}

// --------------------------------------------------------------- PULSE

export interface Pulse {
  kind: "pulse";
  seq: number;
  origin?: number;
  uptimeMin: number;
  rxPerHour: number;
  feedAirtimeSPerH: number;
  activeTotal: number;
  sectionCounts: number[];
}

export function encodePulse(p: Omit<Pulse, "kind">): Uint8Array {
  if (p.sectionCounts.length > 255) throw new CodecError("too many sections");
  const body = new Uint8Array(5 + 9 + p.sectionCounts.length);
  body.set(packHeader(p.seq, p.origin ?? 0), 0);
  const dv = new DataView(body.buffer);
  let o = 5;
  dv.setUint16(o, u16(p.uptimeMin, "uptime_min"), true); o += 2;
  dv.setUint16(o, u16(p.rxPerHour, "rx_per_hour"), true); o += 2;
  dv.setUint16(o, u16(p.feedAirtimeSPerH, "feed_airtime_s_per_h"), true); o += 2;
  dv.setUint16(o, u16(p.activeTotal, "active_total"), true); o += 2;
  body[o] = p.sectionCounts.length; o += 1;
  for (const c of p.sectionCounts) body[o++] = u8(c, "section count");
  return dataBytes(TYPE_PULSE, body);
}

export function decodePulse(body: Uint8Array): Pulse {
  const [h, off0] = unpackHeader(body, 0);
  let off = off0;
  if (body.length < off + 9) throw new CodecError("PULSE too short");
  // DataView works on the WHOLE buffer: offsets here are relative to
  // body, so add the subarray's byteOffset (decodeAny hands us
  // payload.subarray(3) - a view, not a copy).
  const base = body.byteOffset;
  const dv = new DataView(body.buffer);
  const uptimeMin = dv.getUint16(base + off, true);
  const rxPerHour = dv.getUint16(base + off + 2, true);
  const feedAirtime = dv.getUint16(base + off + 4, true);
  const activeTotal = dv.getUint16(base + off + 6, true);
  const n = body[off + 8];
  off += 9;
  if (body.length - off < n) throw new CodecError("PULSE section counts truncated");
  const sectionCounts: number[] = [];
  for (let i = 0; i < n; i++) sectionCounts.push(body[off + i]);
  return { kind: "pulse", seq: h.seq, origin: h.origin, uptimeMin, rxPerHour,
           feedAirtimeSPerH: feedAirtime, activeTotal, sectionCounts };
}

// --------------------------------------------------------------- SECT_SUM

export interface SectSum {
  kind: "sect_sum";
  seq: number;
  origin?: number;
  sectionId: number;
  activeNodes: number;
  packetCount: number;
  delayP50S: number;
  delayP90S: number;
  routeStubs: number[];
}

/** v1.2: wire section ids are 1-based; 0 is reserved (whole-area). */
function checkSectionId(value: number, what: string): number {
  const v = u8(value, what);
  if (v === REFRESH_WHOLE_AREA)
    throw new CodecError(`${what}: 0 is reserved (whole-area)`);
  return v;
}

export function encodeSectSum(s: Omit<SectSum, "kind">): Uint8Array {
  if (s.routeStubs.length > 255) throw new CodecError("too many route stubs");
  const body = new Uint8Array(5 + 10 + 2 * s.routeStubs.length);
  body.set(packHeader(s.seq, s.origin ?? 0), 0);
  const dv = new DataView(body.buffer);
  let o = 5;
  body[o] = checkSectionId(s.sectionId, "section_id"); o += 1;
  body[o] = u8(s.activeNodes, "active_nodes"); o += 1;
  dv.setUint16(o, u16(s.packetCount, "packet_count"), true); o += 2;
  dv.setUint16(o, u16(s.delayP50S, "delay_p50_s"), true); o += 2;
  dv.setUint16(o, u16(s.delayP90S, "delay_p90_s"), true); o += 2;
  body[o] = 0; o += 1; // reserved
  body[o] = s.routeStubs.length; o += 1;
  for (const rid of s.routeStubs) {
    dv.setUint16(o, u16(rid, "route_id"), true); o += 2;
  }
  return dataBytes(TYPE_SECT_SUM, body);
}

export function decodeSectSum(body: Uint8Array): SectSum {
  const [h, off0] = unpackHeader(body, 0);
  let off = off0;
  if (body.length < off + 10) throw new CodecError("SECT_SUM too short");
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const sectionId = checkSectionId(body[off], "decoded section_id");
  const activeNodes = body[off + 1];
  const packetCount = dv.getUint16(off + 2, true);
  const delayP50S = dv.getUint16(off + 4, true);
  const delayP90S = dv.getUint16(off + 6, true);
  // off+8 reserved
  const n = body[off + 9];
  off += 10;
  if (body.length < off + 2 * n) throw new CodecError("SECT_SUM stubs truncated");
  const routeStubs: number[] = [];
  for (let i = 0; i < n; i++)
    routeStubs.push(dv.getUint16(off + 2 * i, true));
  return { kind: "sect_sum", seq: h.seq, origin: h.origin, sectionId,
           activeNodes, packetCount, delayP50S, delayP90S, routeStubs };
}

// --------------------------------------------------------------- ROUTE

export interface Route {
  kind: "route";
  seq: number;
  origin?: number;
  sectionId: number;
  routeId: number;
  packetCount: number;
  delayMedS: number;
  lastHeardMin: number;
  prefixes: number[];
}

export function encodeRoute(r: Omit<Route, "kind">): Uint8Array {
  if (r.prefixes.length > 255) throw new CodecError("too many prefixes");
  const body = new Uint8Array(5 + 10 + r.prefixes.length);
  body.set(packHeader(r.seq, r.origin ?? 0), 0);
  const dv = new DataView(body.buffer);
  let o = 5;
  body[o] = checkSectionId(r.sectionId, "section_id"); o += 1;
  dv.setUint16(o, u16(r.routeId, "route_id"), true); o += 2;
  dv.setUint16(o, u16(r.packetCount, "packet_count"), true); o += 2;
  dv.setUint16(o, u16(r.delayMedS, "delay_med_s"), true); o += 2;
  dv.setUint16(o, u16(r.lastHeardMin, "last_heard_min"), true); o += 2;
  body[o] = r.prefixes.length; o += 1;
  for (const pfx of r.prefixes) body[o++] = u8(pfx, "prefix");
  return dataBytes(TYPE_ROUTE, body);
}

export function decodeRoute(body: Uint8Array): Route {
  const [h, off0] = unpackHeader(body, 0);
  let off = off0;
  if (body.length < off + 10) throw new CodecError("ROUTE too short");
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const sectionId = checkSectionId(body[off], "decoded section_id");
  const routeId = dv.getUint16(off + 1, true);
  const packetCount = dv.getUint16(off + 3, true);
  const delayMedS = dv.getUint16(off + 5, true);
  const lastHeardMin = dv.getUint16(off + 7, true);
  const n = body[off + 9];
  off += 10;
  if (body.length < off + n) throw new CodecError("ROUTE prefixes truncated");
  const prefixes: number[] = [];
  for (let i = 0; i < n; i++) prefixes.push(body[off + i]);
  return { kind: "route", seq: h.seq, origin: h.origin, sectionId, routeId,
           packetCount, delayMedS, lastHeardMin, prefixes };
}

// --------------------------------------------------------------- INTRO

export interface IntroEntry {
  prefix: number;
  name?: string | null;
  lat?: number | null;
  lon?: number | null;
  nodeClass?: number | null;   // INTRO flags bits 2-3; absent = unknown
}

function entryFlags(e: IntroEntry): number {
  let flags = 0;
  if (e.name) flags |= 0x01;
  if (e.lat != null && e.lon != null) flags |= 0x02;
  flags |= ((e.nodeClass ?? 0) & NODE_CLASS_MASK) << NODE_CLASS_SHIFT;
  return flags;
}

export interface Intro {
  kind: "intro";
  seq: number;
  origin?: number;
  entries: IntroEntry[];
  centerLat: number;
  centerLon: number;
  spanM: number;
  /** v1.5: the span the packet itself carried (the decode truth). */
  wireSpanM?: number;
}

function positionDeltas(intro: { centerLat: number; centerLon: number; spanM: number },
                        lat: number, lon: number): [number, number] {
  const spanDeg = intro.spanM / 111320.0;
  const clamp = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v)));
  return [clamp((lat - intro.centerLat) / spanDeg * 32767),
          clamp((lon - intro.centerLon) / spanDeg * 32767)];
}

function positionFromDeltas(intro: { centerLat: number; centerLon: number; spanM: number },
                            dlat: number, dlon: number): [number, number] {
  const spanDeg = intro.spanM / 111320.0;
  return [intro.centerLat + dlat / 32767.0 * spanDeg,
          intro.centerLon + dlon / 32767.0 * spanDeg];
}

export function encodeIntro(intro: Omit<Intro, "kind">): Uint8Array {
  if (intro.entries.length > 255) throw new CodecError("too many intro entries");
  // v1.5: the span rides the packet (Brett's offset-dots fix) - the
  // decoder never has to GUESS the scale the deltas were measured at.
  const spanWire = Math.round(intro.spanM);
  if (!Number.isInteger(spanWire) || spanWire <= 0 || spanWire > 0xffff)
    throw new CodecError(`intro span_m out of wire range: ${intro.spanM}`);
  const spanBytes = new Uint8Array(2);
  spanBytes[0] = spanWire & 0xff;
  spanBytes[1] = (spanWire >> 8) & 0xff;
  const chunks: Uint8Array[] = [packHeader(intro.seq, intro.origin ?? 0),
                                spanBytes,
                                Uint8Array.of(intro.entries.length)];
  for (const entry of intro.entries) {
    const nameBytes = new TextEncoder().encode((entry.name || "").slice(0, MAX_NAME));
    const flags = entryFlags(entry);
    const head = Uint8Array.of(u8(entry.prefix, "prefix"), flags, nameBytes.length);
    const parts: Uint8Array[] = [head];
    if (nameBytes.length) parts.push(nameBytes);
    if (flags & 0x02) {
      const [dlat, dlon] = positionDeltas(intro, entry.lat!, entry.lon!);
      const pos = new Uint8Array(4);
      const dv = new DataView(pos.buffer);
      dv.setInt16(0, dlat, true);
      dv.setInt16(2, dlon, true);
      parts.push(pos);
    }
    const size = parts.reduce((n, p) => n + p.length, 0);
    const entryBytes = new Uint8Array(size);
    let o = 0;
    for (const p of parts) { entryBytes.set(p, o); o += p.length; }
    chunks.push(entryBytes);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { body.set(c, o); o += c.length; }
  return dataBytes(TYPE_INTRO, body);
}

export function decodeIntro(
  body: Uint8Array,
  opts: { centerLat?: number; centerLon?: number; spanM?: number } = {},
): Intro {
  const centerLat = opts.centerLat ?? 0.0;
  const centerLon = opts.centerLon ?? 0.0;
  const [h, off0] = unpackHeader(body, 0);
  let off = off0;
  // v1.5: the packet carries its OWN span (2 LE meters) - the truth
  // the deltas were measured at. The opts spanM (a caller's LAYOUT
  // guess) is cross-check only: a mismatch throws, loudly, instead of
  // scaling every dot wrong in silence (Brett's offset-dots bug).
  // No opts = TRUST the packet. v1.0-1.4 packets carry no span field:
  // fall back to the caller's span (or the era's 40 km assumption)
  // for packets still in flight from a pre-v1.5 host.
  let spanM: number;
  let wireSpan: number | undefined;
  if (h.version >= 0x05) {
    if (body.length < off + 2) throw new CodecError("INTRO too short for span field");
    wireSpan = body[off] | (body[off + 1] << 8);
    off += 2;
    if (wireSpan <= 0) throw new CodecError(`INTRO span must be positive, got ${wireSpan}`);
    if (opts.spanM != null && Math.round(opts.spanM) !== wireSpan)
      throw new CodecError(
        `INTRO span mismatch: packet says ${wireSpan} m, caller assumed ${Math.round(opts.spanM)} m`);
    spanM = wireSpan;
  } else {
    spanM = opts.spanM ?? 40000.0;
  }
  if (body.length < off + 1) throw new CodecError("INTRO too short");
  const count = body[off]; off += 1;
  const entries: IntroEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (body.length < off + 3) throw new CodecError("INTRO entry truncated");
    const prefix = body[off];
    const flags = body[off + 1];
    const nameLen = body[off + 2];
    off += 3;
    const nodeClass = (flags >> NODE_CLASS_SHIFT) & NODE_CLASS_MASK;
    let name: string | null = null;
    if (flags & 0x01) {
      if (body.length < off + nameLen) throw new CodecError("INTRO name truncated");
      name = new TextDecoder().decode(body.subarray(off, off + nameLen));
    }
    off += nameLen;
    let lat: number | null = null;
    let lon: number | null = null;
    if (flags & 0x02) {
      if (body.length < off + 4) throw new CodecError("INTRO position truncated");
      const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
      lat = 0; lon = 0;
      [lat, lon] = positionFromDeltas(
        { centerLat, centerLon, spanM },
        dv.getInt16(off, true), dv.getInt16(off + 2, true));
      off += 4;
    }
    entries.push({ prefix, name, lat, lon, nodeClass });
  }
  return { kind: "intro", seq: h.seq, origin: h.origin, entries,
           centerLat, centerLon, spanM, wireSpanM: wireSpan };
}

// --------------------------------------------------------------- LAYOUT

export interface Layout {
  kind: "layout";
  seq: number;
  origin?: number;
  grid: number;
  centerLat: number;
  centerLon: number;
  spanM: number;
  name: string;
}

export function encodeLayout(l: Omit<Layout, "kind">): Uint8Array {
  if (l.grid < 2 || l.grid > 5) throw new CodecError(`grid out of range: ${l.grid}`);
  const nameBytes = new TextEncoder().encode(l.name.slice(0, MAX_NAME));
  const body = new Uint8Array(5 + 1 + 8 + 2 + 1 + nameBytes.length);
  body.set(packHeader(l.seq, l.origin ?? 0), 0);
  const dv = new DataView(body.buffer);
  let o = 5;
  body[o] = l.grid; o += 1;
  dv.setInt32(o, Math.round(l.centerLat * 1e6), true); o += 4;
  dv.setInt32(o, Math.round(l.centerLon * 1e6), true); o += 4;
  dv.setUint16(o, u16(l.spanM, "span_m"), true); o += 2;
  body[o] = nameBytes.length; o += 1;
  body.set(nameBytes, o);
  return dataBytes(TYPE_LAYOUT, body);
}

export function decodeLayout(body: Uint8Array): Layout {
  const [h, off0] = unpackHeader(body, 0);
  let off = off0;
  if (body.length < off + 12) throw new CodecError("LAYOUT too short");
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const grid = body[off]; off += 1;
  const centerLat = dv.getInt32(off, true) / 1e6; off += 4;
  const centerLon = dv.getInt32(off, true) / 1e6; off += 4;
  const spanM = dv.getUint16(off, true); off += 2;
  const nameLen = body[off]; off += 1;
  if (body.length < off + nameLen) throw new CodecError("LAYOUT name truncated");
  const name = new TextDecoder().decode(body.subarray(off, off + nameLen));
  return { kind: "layout", seq: h.seq, origin: h.origin, grid,
           centerLat, centerLon, spanM, name };
}

// --------------------------------------------------------------- SNAP

export interface Snap {
  kind: "snap";
  seq: number;
  origin?: number;
  snapId: number;
  part: number;
  parts: number;
  body: Uint8Array;
}

export function encodeSnap(s: Omit<Snap, "kind">): Uint8Array {
  if (s.body.length > 255) throw new CodecError(`SNAP body too long: ${s.body.length}`);
  const body = new Uint8Array(5 + 3 + s.body.length);
  body.set(packHeader(s.seq, s.origin ?? 0), 0);
  body[5] = u8(s.snapId, "snap_id");
  body[6] = u8(s.part, "part");
  body[7] = u8(s.parts, "parts");
  body.set(s.body, 8);
  return dataBytes(TYPE_SNAP, body);
}

export function decodeSnap(body: Uint8Array): Snap {
  const [h, off0] = unpackHeader(body, 0);
  const off = off0;
  if (body.length < off + 3) throw new CodecError("SNAP too short");
  return { kind: "snap", seq: h.seq, origin: h.origin, snapId: body[off],
           part: body[off + 1], parts: body[off + 2],
           body: body.slice(off + 3) };
}

// --------------------------------------------------------------- REFRESH_REQ

export const REFRESH_SPAN_HOST_DECIDES = 0; // v1.3: 0 = host decides

export interface RefreshReq {
  kind: "refresh_req";
  seq: number;
  origin?: number;       // client's own 2-byte id (v1.1)
  refreshKind: number;   // 1 = section, 2 = route
  target: number;
  host?: number;         // preferred origin, 0 = owner decides (v1.1)
  nonce: number;
  spanKm?: number;       // v1.3: wanted window 20/40/60; 0 = host decides
}

export function encodeRefreshReq(r: Omit<RefreshReq, "kind">): Uint8Array {
  if (r.refreshKind !== REFRESH_KIND_SECTION && r.refreshKind !== REFRESH_KIND_ROUTE)
    throw new CodecError(`refresh kind invalid: ${r.refreshKind}`);
  // v1.3 body: kind(1) + target(2) + host(2) + nonce(2) + span_km(2)
  const body = new Uint8Array(5 + 9);
  body.set(packHeader(r.seq, r.origin ?? 0), 0);
  const dv = new DataView(body.buffer);
  body[5] = r.refreshKind;
  dv.setUint16(6, u16(r.target, "target"), true);
  dv.setUint16(8, u16(r.host ?? REFRESH_HOST_ANY, "host"), true);
  dv.setUint16(10, u16(r.nonce, "nonce"), true);
  dv.setUint16(12, u16(r.spanKm ?? REFRESH_SPAN_HOST_DECIDES, "span_km"), true);
  return dataBytes(TYPE_REFRESH_REQ, body);
}

export function decodeRefreshReq(body: Uint8Array): RefreshReq {
  const [h, off0] = unpackHeader(body, 0);
  const off = off0;
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  if (h.version >= 0x04) {
    // v1.3 body: kind(1) + target(2) + host(2) + nonce(2) + span_km(2)
    if (body.length < off + 9) throw new CodecError("REFRESH_REQ too short");
    return { kind: "refresh_req", seq: h.seq, origin: h.origin,
             refreshKind: body[off], target: dv.getUint16(off + 1, true),
             host: dv.getUint16(off + 3, true),
             nonce: dv.getUint16(off + 5, true),
             spanKm: dv.getUint16(off + 7, true) };
  }
  if (h.version >= 0x02) {
    if (body.length < off + 7) throw new CodecError("REFRESH_REQ too short");
    return { kind: "refresh_req", seq: h.seq, origin: h.origin,
             refreshKind: body[off], target: dv.getUint16(off + 1, true),
             host: dv.getUint16(off + 3, true),
             nonce: dv.getUint16(off + 5, true),
             spanKm: REFRESH_SPAN_HOST_DECIDES };
  }
  // v1 body: kind(1) + target(2) + nonce(2), no host field
  if (body.length < off + 5) throw new CodecError("REFRESH_REQ too short");
  return { kind: "refresh_req", seq: h.seq, origin: h.origin,
           refreshKind: body[off], target: dv.getUint16(off + 1, true),
           host: REFRESH_HOST_ANY, nonce: dv.getUint16(off + 3, true),
           spanKm: REFRESH_SPAN_HOST_DECIDES };
}

// --------------------------------------------------------------- generic

export type ScopePacket =
  | Pulse | SectSum | Route | Intro | Layout | Snap | RefreshReq;

/** Decode any scope packet from a FULL GRP_DATA plaintext
 *  (data_type(2) + len(1) + body, exactly what CMD 62 sends). */
export function decodeAny(payload: Uint8Array): ScopePacket {
  const dataType = peekDataType(payload);
  const body = payload.subarray(3);
  switch (dataType) {
    case TYPE_PULSE: return decodePulse(body);
    case TYPE_SECT_SUM: return decodeSectSum(body);
    case TYPE_ROUTE: return decodeRoute(body);
    case TYPE_INTRO: return decodeIntro(body);
    case TYPE_LAYOUT: return decodeLayout(body);
    case TYPE_SNAP: return decodeSnap(body);
    case TYPE_REFRESH_REQ: return decodeRefreshReq(body);
    default: throw new CodecError(`unknown data_type ${dataType.toString(16)}`);
  }
}
