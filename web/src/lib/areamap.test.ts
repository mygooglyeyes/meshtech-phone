/**
 * Area map tests - the geographic renderer that replaced the button
 * grid. Pins the conventions Brett reviews the app by:
 *   - NORTH IS UP (row 0 = NW corner at the TOP of the svg)
 *   - section numbering row-major from the NW corner (grid.ts contract)
 *   - ghost numerals, counts, dots and clickable cells all present
 *   - positionless nodes are never drawn
 */
import * as assert from "node:assert";
import { test, runIfMain } from "./testrunner.ts";
import { areaMapSvg } from "./areamap.ts";

// 2x2 grid, 1 degree across, so every cell is exactly 0.5 degrees.
const OPTS = {
  grid: 2,
  west: -123.0,
  south: 38.0,
  spanDeg: 1.0,
  counts: [1, 0, 3, 2] as (number | null)[],
  nodes: [
    { lat: 38.9, lon: -122.9, name: "north node", nodeClass: 1 },
    { lat: 38.1, lon: -122.1, name: "south node", nodeClass: 2 },
    { lat: null, lon: null, name: "positionless" },
  ],
};

test("north is up: the northernmost node has the SMALLEST svg y", () => {
  const svg = areaMapSvg(OPTS);
  const y = (frag: string): number => {
    const m = svg.match(new RegExp(`cy="(\\d+[\\d.]*)"[^>]*><title>${frag}`));
    assert.ok(m, `no dot with title ${frag}`);
    return parseFloat(m![1]);
  };
  const northY = y("north node");
  const southY = y("south node");
  assert.ok(
    northY < southY,
    `north node (y=${northY}) must be ABOVE south node (y=${southY})`,
  );
});

test("row 0 is the NW corner at the TOP: section 1 rect is northernmost", () => {
  const svg = areaMapSvg(OPTS);
  // Row rects are drawn top-down WITHOUT reflection (row 0's rect y =
  // south edge). Section 1's cell rect y must equal the square's south
  // edge (38.0) - the TOP row on screen, because the whole square's
  // latitudes are reflected by fy() (see the north-up dot test).
  // v1.2: ids are 1-based everywhere - the NW cell IS data-section="1".
  const m = svg.match(/<rect class="cell" data-section="1" x="(-?[\d.]+)" y="([\d.]+)"/);
  assert.ok(m, "section 1 cell rect not found");
  const y0 = parseFloat(m![2]);
  assert.strictEqual(y0, 38.0, "section 1 rect starts at the square's south edge = screen TOP");
  // ...and section 3 (row 1 = bottom row, west column) sits lower.
  const m2 = svg.match(/<rect class="cell" data-section="3" x="(-?[\d.]+)" y="([\d.]+)"/);
  assert.ok(m2, "section 3 cell rect not found");
  const y2 = parseFloat(m2![2]);
  assert.strictEqual(y2, 38.5, "section 3 (row 1) rect starts half a cell lower");
});

test("every section gets a ghost numeral and a count; numerals are 1-based", () => {
  const svg = areaMapSvg(OPTS);
  assert.strictEqual(
    (svg.match(/class="ghost"/g) || []).length, 4,
    "one ghost numeral per section",
  );
  assert.strictEqual(
    (svg.match(/class="cellcount"/g) || []).length, 4,
    "one count per section",
  );
  // Numerals ARE the wire ids (v1.2: 1-based everywhere). Read only
  // the ghost-class texts - counts may legitimately be 0.
  const ghosts = [...svg.matchAll(/class="ghost"[^>]*>(\d+)<\/text>/g)]
    .map((m) => m[1]);
  assert.deepStrictEqual(ghosts, ["1", "2", "3", "4"],
    "numerals are the 1-based wire ids in row-major order, never 0");
  // OPTS has all counts known, so probe a null explicitly.
  const withUnknown = areaMapSvg({ ...OPTS, counts: [null, 0, 3, 2] });
  assert.ok(withUnknown.includes(">?</text>"), "unknown count renders as ?");
});

test("positionless nodes are never drawn; classes colour the dots", () => {
  const svg = areaMapSvg(OPTS);
  assert.strictEqual((svg.match(/class="dot /g) || []).length, 2,
    "only positioned nodes get dots");
  assert.ok(svg.includes("dot-repeater"));
  assert.ok(svg.includes("dot-companion"));
  // Node names only ever reach the DOM through <title> (esc'd source).
  assert.ok(svg.includes("<title>north node</title>"));
});

test("clickable cells exist for every section, drawn above the dots", () => {
  const svg = areaMapSvg(OPTS);
  assert.strictEqual((svg.match(/class="cell" /g) || []).length, 4);
  const lastCell = svg.lastIndexOf('<rect class="cell"');
  const lastDot = svg.lastIndexOf("<circle");
  assert.ok(lastCell > lastDot, "cells must render AFTER dots so taps win");
});

runIfMain();
