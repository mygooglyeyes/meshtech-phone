/**
 * State tests (2026-09-23): the 60 km INTRO projection fix.
 *
 * THE BUG, pinned: the wire carries no span; the live decode assumed
 * the old 40 km map. On hilltop's 60 km home box every positioned dot
 * landed at 2/3 of its true offset from center - and a sized window's
 * INTRO decoded at 2x. The same node re-advertised under a DIFFERENT
 * decode era landed tens of meters from its earlier row: the "second
 * dot slightly offset" twins on the map.
 *
 * TOLERANCES: wire positions are int16 deltas, so every round trip
 * carries up to ~1 m of quantization (half an LSB). 1e-4 degrees
 * (~11 m) is far above that noise and far below anything visible.
 */
import * as assert from "node:assert";
import { test, runIfMain } from "./testrunner.ts";
import { decodeIntro, encodeIntro, type Layout } from "./codec.ts";
import { ScopeState } from "./state.ts";

const HOME = { grid: 3, centerLat: 38.1074, centerLon: -122.5697,
  spanM: 60000, name: "Home", seq: 1, kind: "layout" } as const;

/** Encode an INTRO at a layout's real span (what the server does),
 * then decode on the LIVE path (no opts) exactly as applyIntro
 * receives it from the wire. */
function liveIntro(entries: { prefix: number; name: string;
  lat: number; lon: number }[], spanM: number) {
  const raw = encodeIntro({ seq: 2, centerLat: HOME.centerLat,
    centerLon: HOME.centerLon, spanM, entries });
  return decodeIntro(raw.subarray(3));
}

test("intro positions land true on the 60 km box (span-scaling fix)", () => {
  const s = new ScopeState();
  s.apply(HOME as unknown as Layout);
  // a node halfway to the box edge, and one far west
  const trueLat = HOME.centerLat + 0.15;
  const trueLon = HOME.centerLon - 0.2;
  s.apply(liveIntro([
    { prefix: 0x42, name: "TruePlace", lat: trueLat, lon: trueLon },
  ], 60000));
  const node = s.nodes.get(0x42)!;
  assert.ok(Math.abs(node.lat! - trueLat) < 1e-4,
    `lat off: ${node.lat} vs ${trueLat}`);
  assert.ok(Math.abs(node.lon! - trueLon) < 1e-4,
    `lon off: ${node.lon} vs ${trueLon}`);
  // and the dot is INSIDE the 60 km map, where it belongs
  assert.ok(node.lat! > s.geometry!.south && node.lat! < s.geometry!.north);
});

test("40 km maps decode exactly as before (factor 1)", () => {
  const s = new ScopeState();
  s.apply({ ...HOME, spanM: 40000 } as unknown as Layout);
  const trueLat = HOME.centerLat + 0.1;
  s.apply(liveIntro([
    { prefix: 0x43, name: "Forty", lat: trueLat, lon: HOME.centerLon },
  ], 40000));
  const node = s.nodes.get(0x43)!;
  assert.ok(Math.abs(node.lat! - trueLat) < 1e-4,
    `the 40 km path must be unchanged: ${node.lat}`);
});

test("the same node lands on the SAME spot in every decode era", () => {
  // The twin-killer: the node's advert arrives while a 20 km window
  // is live, then again on the 60 km home layout. With the fix both
  // eras decode to the SAME true place - one dot, no drift, nothing
  // for a twin to grow from.
  const s = new ScopeState();
  s.apply(HOME as unknown as Layout);
  const trueLat = HOME.centerLat + 0.05;
  const trueLon = HOME.centerLon + 0.05;
  // era 1: a 20 km window with the same center
  s.apply({ ...HOME, spanM: 20000 } as unknown as Layout);
  s.apply(liveIntro([
    { prefix: 0x77, name: "EraNode", lat: trueLat, lon: trueLon },
  ], 20000));
  const era1 = { ...s.nodes.get(0x77)! };
  // era 2: back to the 60 km home layout, same node re-advertised
  s.apply(HOME as unknown as Layout);
  s.apply(liveIntro([
    { prefix: 0x77, name: "EraNode", lat: trueLat, lon: trueLon },
  ], 60000));
  const era2 = s.nodes.get(0x77)!;
  assert.ok(Math.abs(era1.lat! - trueLat) < 1e-4, `era 1 off: ${era1.lat}`);
  assert.ok(Math.abs(era2.lat! - trueLat) < 1e-4, `era 2 off: ${era2.lat}`);
  assert.ok(Math.abs(era1.lat! - era2.lat!) < 1e-4,
    "the two eras must agree - drift here is the twin factory");
  // ONE node entry for the prefix: the map draws one dot.
  assert.strictEqual([...s.nodes.values()].filter((n) =>
    n.prefix === 0x77).length, 1);
});

test("two different nodes close together stay two dots", () => {
  const s = new ScopeState();
  s.apply(HOME as unknown as Layout);
  s.apply(liveIntro([
    { prefix: 0x3b, name: "KN6OBW DT", lat: HOME.centerLat + 0.01,
      lon: HOME.centerLon },
    { prefix: 0xa8, name: "Other Node", lat: HOME.centerLat + 0.01,
      lon: HOME.centerLon },
  ], 60000));
  assert.strictEqual(s.nodes.size, 2);   // never merged: different names
});

runIfMain();
