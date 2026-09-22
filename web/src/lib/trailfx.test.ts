/**
 * Trail effects tests - aging classifier + pulse markup rules
 * (outpost-inspired visuals, meshtech-scope TODOS #16).
 */
import * as assert from "node:assert";
import { test, runIfMain } from "./testrunner.ts";
import {
  AGING_LABEL, agingState, startTrailPulse, trailFx,
} from "./trailfx.ts";

const NOW = 1_000_000_000_000; // fixed clock for deterministic tests
const MIN = 60_000;

test("aging bands match the documented windows", () => {
  // never heard -> ghost
  assert.strictEqual(agingState(null, NOW), "ghost");
  // <= 6 min fresh
  assert.strictEqual(agingState(NOW - 0, NOW), "fresh");
  assert.strictEqual(agingState(NOW - 6 * MIN, NOW), "fresh");
  // <= 30 min fading
  assert.strictEqual(agingState(NOW - 6 * MIN - 1, NOW), "fading");
  assert.strictEqual(agingState(NOW - 30 * MIN, NOW), "fading");
  // <= 6 h overdue
  assert.strictEqual(agingState(NOW - 30 * MIN - 1, NOW), "overdue");
  assert.strictEqual(agingState(NOW - 6 * 60 * MIN, NOW), "overdue");
  // past the window -> ghost again
  assert.strictEqual(agingState(NOW - 6 * 60 * MIN - 1, NOW), "ghost");
  // future timestamps clamp to fresh, never throw
  assert.strictEqual(agingState(NOW + 5 * MIN, NOW), "fresh");
});

test("labels cover every state", () => {
  for (const s of ["fresh", "fading", "overdue", "ghost"] as const) {
    assert.strictEqual(typeof AGING_LABEL[s], "string");
    assert.ok(AGING_LABEL[s].length > 0);
  }
});

test("live route with 2+ points animates a pulse over the path", () => {
  const fx = trailFx({
    points: [{ lon: -122.57, lat: 38.09 }, { lon: -122.52, lat: 38.10 },
      { lon: -122.51, lat: 38.11 }],
    lastHeardMin: 4,           // within the fresh window
    now: NOW,
    play: true,                // simulates a live-data arrival
  });
  assert.strictEqual(fx.state, "fresh");
  assert.ok(fx.cls.includes("aging-fresh"));
  assert.ok(fx.pulse.includes("animateMotion"));
  // Motion path lives in REFLECTED screen space (SVG y grows down):
  // y = maxLat + minLat - lat, so the pulse rides the SAME geometry
  // as the drawn polyline. The southernmost hop (38.09) must map to
  // the LARGEST y (38.11, near the bottom) and the northern hop to
  // the smallest - Brett caught the dot flying the mirror image of
  // the drawn line, 2026-09-18.
  assert.ok(fx.pulse.includes("-122.57,38.11"), "southern hop at bottom");
  assert.ok(fx.pulse.includes("-122.52,38.1"), "middle hop");
  assert.ok(fx.pulse.includes("-122.51,38.09"), "northern hop at top");
});

test("ghost routes and single points never animate", () => {
  const ghost = trailFx({
    points: [{ lon: 1, lat: 2 }, { lon: 3, lat: 4 }],
    lastHeardMin: 24 * 60,     // a day old
    now: NOW,
    play: true,                // even an arrival never animates a ghost
  });
  assert.strictEqual(ghost.state, "ghost");
  assert.strictEqual(ghost.pulse, "");
  assert.ok(ghost.cls.includes("aging-ghost"));

  const lone = trailFx({
    points: [{ lon: 1, lat: 2 }],
    lastHeardMin: 1,
    now: NOW,
    play: true,
  });
  assert.strictEqual(lone.pulse, ""); // no path to travel
});

test("reduced motion collapses to the static final state", () => {
  const fx = trailFx({
    points: [{ lon: 1, lat: 2 }, { lon: 3, lat: 4 }],
    lastHeardMin: 1,
    now: NOW,
  });
  assert.strictEqual(fx.pulse, "");
  assert.strictEqual(fx.state, "fresh"); // classification still honest
});

test("no pulse by default; only a live-data arrival replays one", () => {
  const pts = [{ lon: 1, lat: 2 }, { lon: 3, lat: 4 }];
  // Page open / static render: NO moving dot (Brett 2026-09-18 - the
  // trail reflects data, it is not a screensaver).
  const quiet = trailFx({ points: pts, lastHeardMin: 1, now: NOW });
  assert.strictEqual(quiet.pulse, "");
  assert.strictEqual(quiet.durS, 0);
  // A data arrival asks for one pass: markup present, finite repeats.
  const replay = trailFx({ points: pts, lastHeardMin: 0, now: NOW,
    play: true });
  assert.ok(replay.pulse.includes("animateMotion"));
  assert.ok(replay.pulse.includes('repeatCount="1"'), "one pass, no loop");
  assert.ok(replay.durS > 0, "caller gets a cleanup duration");
  // The replay helper no-ops safely without a pulse.
  const fake = { querySelector: () => null } as unknown as SVGSVGElement;
  startTrailPulse(fake, quiet); // must not throw
});

test("lastHeardMin null is ghost even with points", () => {
  const fx = trailFx({
    points: [{ lon: 1, lat: 2 }, { lon: 3, lat: 4 }],
    lastHeardMin: null,
    now: NOW,
    play: true,
  });
  assert.strictEqual(fx.state, "ghost");
  assert.strictEqual(fx.pulse, "");
});

runIfMain();
