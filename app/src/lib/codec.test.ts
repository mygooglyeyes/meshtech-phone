/**
 * Codec tests - mirrors meshtech-scope/tests/test_codec.py.
 * The golden vectors MUST equal tests/golden_vectors.json (regenerate
 * both with tools/gen_golden.py after any wire change).
 */
import * as assert from "node:assert";
import { test, runIfMain } from "./testrunner.ts";
import { esc, escOr } from "./esc.ts";
import {
  CodecError, TYPE_LAYOUT, TYPE_PULSE, TYPE_REFRESH_REQ, TYPE_ROUTE,
  TYPE_SECT_SUM, decodeAny, decodeIntro, decodeLayout, decodePulse,
  decodeRefreshReq, decodeRoute, decodeSectSum, decodeSnap, encodeIntro,
  encodeLayout, encodePulse, encodeRefreshReq, encodeRoute, encodeSectSum,
  encodeSnap, peekDataType,
} from "./codec.ts";

// Golden vectors - DO NOT hand-edit; regenerate with gen_golden.py.
// v1.2 (PROTO_VERSION 0x03): version byte 03, section ids 1-based
// (sect_sum/route vectors carry section_id 01 = the NW square).
const GOLDEN: Record<string, string> = {
  "pulse": "0153170313017eb1d20404000900280009090305080200010406",
  "sect_sum": "0253130304007eb101017e003000300300022102cdab",
  "route": "0353120302007eb101efbe38000400110003112233",
  "layout": "0553150303007eb10344d61200a01ce9ff409c0464656d6f",
  "intro": "04531c0302007eb10211030748696c6c746f7024002400220105416c696365",
  "refresh": "11530c030200420002efbe7eb13412",
};

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

for (const [name, golden] of Object.entries(GOLDEN)) {
  test(`golden vector: ${name}`, () => {
    const raw = fromHex(golden);
    const obj = decodeAny(raw);
    let re: Uint8Array;
    switch (obj.kind) {
      case "pulse": re = encodePulse(obj); break;
      case "sect_sum": re = encodeSectSum(obj); break;
      case "route": re = encodeRoute(obj); break;
      case "layout": re = encodeLayout(obj); break;
      case "intro":
        re = encodeIntro({ seq: obj.seq, origin: obj.origin,
                           entries: obj.entries,
                           centerLat: 0.0, centerLon: 0.0, spanM: 40000.0 });
        break;
      case "refresh_req": re = encodeRefreshReq(obj); break;
      default: throw new Error(`unhandled ${obj.kind}`);
    }
    assert.strictEqual(hex(re), golden);
  });
}

test("pulse roundtrip", () => {
  const raw = encodePulse({ seq: 7, uptimeMin: 1234, rxPerHour: 5321,
    feedAirtimeSPerH: 9, activeTotal: 40,
    sectionCounts: [3, 5, 8, 2, 0, 1, 4, 6, 3] });
  const out = decodePulse(raw.subarray(3));
  assert.strictEqual(out.seq, 7);
  assert.strictEqual(out.uptimeMin, 1234);
  assert.strictEqual(out.rxPerHour, 5321);
  assert.strictEqual(out.activeTotal, 40);
  assert.deepStrictEqual(out.sectionCounts, [3, 5, 8, 2, 0, 1, 4, 6, 3]);
});

test("sect_sum roundtrip", () => {
  const raw = encodeSectSum({ seq: 1, sectionId: 4, activeNodes: 7,
    packetCount: 1520, delayP50S: 3, delayP90S: 9,
    routeStubs: [0x1234, 0xabcd] });
  const out = decodeSectSum(raw.subarray(3));
  assert.strictEqual(out.packetCount, 1520);
  assert.deepStrictEqual(out.routeStubs, [0x1234, 0xabcd]);
});

test("route roundtrip", () => {
  const raw = encodeRoute({ seq: 99, sectionId: 2, routeId: 0xbeef,
    packetCount: 312, delayMedS: 4, lastHeardMin: 17,
    prefixes: [0x11, 0x22, 0x33] });
  const out = decodeRoute(raw.subarray(3));
  assert.strictEqual(out.routeId, 0xbeef);
  assert.deepStrictEqual(out.prefixes, [0x11, 0x22, 0x33]);
});

test("intro roundtrip with positions", () => {
  const raw = encodeIntro({ seq: 5, centerLat: 37.0, centerLon: -122.0,
    spanM: 40000.0, entries: [
      { prefix: 0x11, name: "Hilltop", lat: 37.1, lon: -122.1 },
      { prefix: 0x22, name: "Relay2" },
      { prefix: 0x33 },
    ] });
  const out = decodeIntro(raw.subarray(3), { centerLat: 37.0,
    centerLon: -122.0, spanM: 40000.0 });
  assert.strictEqual(out.entries[0].name, "Hilltop");
  assert.ok(Math.abs(out.entries[0].lat! - 37.1) < 0.002);
  assert.strictEqual(out.entries[1].lat, null);
});

// THE ZERO-DOTS REGRESSION (2026-09-22): the LIVE path decodes INTRO
// without center opts (center 0,0) and the state re-projects by adding
// the LAYOUT center back. The decode must be LINEAR so that
// reconstruction is exact: decoded_no_center + center === decoded_with_center.
test("intro decode without center is linear - layout-center re-projection is exact (zero-dots regression)", () => {
  const centerLat = 38.1074, centerLon = -122.5697, spanM = 40000.0;
  const raw = encodeIntro({ seq: 1, centerLat, centerLon, spanM,
    entries: [
      { prefix: 0x3e, name: "Novato Oakview", lat: 38.09191, lon: -122.566098 },
      { prefix: 0x0b, name: "Hamilton DR", lat: 38.07183, lon: -122.5379 },
    ] });
  const body = raw.subarray(3);
  const withCenter = decodeIntro(body, { centerLat, centerLon, spanM });
  const noCenter = decodeIntro(body);          // the live path (center 0)
  for (let i = 0; i < withCenter.entries.length; i++) {
    const w = withCenter.entries[i], n = noCenter.entries[i];
    if (w.lat == null) { assert.strictEqual(n.lat, null); continue; }
    assert.ok(Math.abs((n.lat! + centerLat) - w.lat!) < 1e-9,
      `lat re-projection off: ${n.lat} + ${centerLat} != ${w.lat}`);
    assert.ok(Math.abs((n.lon! + centerLon) - w.lon!) < 1e-9,
      `lon re-projection off: ${n.lon} + ${centerLon} != ${w.lon}`);
    // and the re-projected value lands in Novato, not the ocean
    assert.ok(Math.abs(n.lat! + centerLat - 38.09) < 0.03);
  }
});

test("layout roundtrip", () => {
  const raw = encodeLayout({ seq: 3, grid: 3, centerLat: 37.4419,
    centerLon: -122.143, spanM: 40000, name: "Test area" });
  const out = decodeLayout(raw.subarray(3));
  assert.strictEqual(out.grid, 3);
  assert.ok(Math.abs(out.centerLat - 37.4419) < 1e-6);
  assert.strictEqual(out.name, "Test area");
});

test("snap roundtrip", () => {
  const raw = encodeSnap({ seq: 8, snapId: 2, part: 1, parts: 3,
    body: new Uint8Array([1, 2, 3]) });
  const out = decodeSnap(raw.subarray(3));
  assert.strictEqual(out.part, 1);
  assert.strictEqual(out.parts, 3);
});

test("refresh roundtrip via decodeAny", () => {
  const raw = encodeRefreshReq({ seq: 11, origin: 0x0042, refreshKind: 2,
    target: 0xbeef, host: 0xb17e, nonce: 0x1234 });
  const out = decodeAny(raw);
  assert.strictEqual(out.kind, "refresh_req");
  assert.strictEqual((out as any).refreshKind, 2);
  assert.strictEqual((out as any).origin, 0x0042);
  assert.strictEqual((out as any).host, 0xb17e);
  assert.strictEqual((out as any).nonce, 0x1234);
});

test("refresh defaults are owner-decides", () => {
  const raw = encodeRefreshReq({ seq: 1, refreshKind: 1, target: 4,
    nonce: 5 });
  const out = decodeAny(raw);
  assert.strictEqual((out as any).host, 0x0000);
  assert.strictEqual((out as any).origin, 0);
});

test("v1 packets still decode (origin 0)", () => {
  // hand-built v1 LAYOUT: 3-byte header, no origin field
  const v1 = fromHex("0553130103000344d61200a01ce9ff409c0464656d6f");
  const layout = decodeAny(v1) as any;
  assert.strictEqual(layout.origin, 0);
  assert.strictEqual(layout.grid, 3);
  assert.strictEqual(layout.name, "demo");
});

test("intro node class roundtrip", () => {
  const raw = encodeIntro({ seq: 5, origin: 0xb17e,
    centerLat: 37.0, centerLon: -122.0, spanM: 40000.0, entries: [
      { prefix: 0x11, name: "Hilltop", lat: 37.1, lon: -122.1,
        nodeClass: 1 },
      { prefix: 0x22, name: "Phone", nodeClass: 2 },
      { prefix: 0x33 },
    ] });
  const out = decodeIntro(raw.subarray(3), { centerLat: 37.0,
    centerLon: -122.0, spanM: 40000.0 });
  assert.strictEqual(out.entries[0].nodeClass, 1);
  assert.strictEqual(out.entries[1].nodeClass, 2);
  assert.strictEqual(out.entries[2].nodeClass, 0);
  assert.strictEqual(out.entries[0].name, "Hilltop");
});

test("intro class bits leave golden-vector bytes untouched", () => {
  // encoding WITHOUT class must equal the pinned vector exactly
  const raw = encodeIntro({ seq: 2, origin: 0xb17e,
    centerLat: 0.0, centerLon: 0.0, spanM: 40000.0, entries: [
      { prefix: 0x11, name: "Hilltop", lat: 0.0004, lon: 0.0004 },
      { prefix: 0x22, name: "Alice" },
    ] });
  assert.strictEqual(hex(raw),
    "04531c0302007eb10211030748696c6c746f7024002400220105416c696365");
});

test("esc neutralises wire-string injection", () => {
  // hostile LAYOUT/INTRO name arriving over the shared channel
  assert.strictEqual(esc('<img src=x onerror=alert(1)>'),
    "&lt;img src=x onerror=alert(1)&gt;");
  assert.strictEqual(esc('"> <script>'), "&quot;&gt; &lt;script&gt;");
  assert.strictEqual(esc("a&b'c"), "a&amp;b&#39;c");
  assert.strictEqual(escOr(null), "");
  assert.strictEqual(escOr(undefined), "");
  assert.strictEqual(escOr("safe"), "safe");
});

test("payload budget respected", () => {
  const pulse = encodePulse({ seq: 0, uptimeMin: 0, rxPerHour: 0xffff,
    feedAirtimeSPerH: 99, activeTotal: 0xffff, sectionCounts: new Array(25).fill(9) });
  assert.ok(pulse.length <= 120);
  const route = encodeRoute({ seq: 0, sectionId: 1, routeId: 0,
    packetCount: 0, delayMedS: 0, lastHeardMin: 0,
    prefixes: [0, 1, 2, 3, 4, 5, 6, 7] });
  assert.ok(route.length <= 120);
});

test("unknown type raises", () => {
  assert.throws(() => decodeAny(fromHex("995303010000")), CodecError);
});

test("peek data type", () => {
  const raw = encodeLayout({ seq: 1, grid: 3, centerLat: 1, centerLon: 2,
    spanM: 1000, name: "x" });
  assert.strictEqual(peekDataType(raw), TYPE_LAYOUT);
});

runIfMain();
