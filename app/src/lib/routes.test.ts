/**
 * Route naming tests - Brett (2026-09-18): route rows must read as
 * node names joined by GRAPHICAL arrows, never bare hex ids, and must
 * degrade honestly when hop names are missing.
 */
import * as assert from "node:assert";
import { test, runIfMain } from "./testrunner.ts";
import { ROUTE_ARROW, routeDisplayName } from "./routes.ts";

test("known hops join with the graphical arrow", () => {
  const out = routeDisplayName(["Hilltop", "Hamilton", "Bel Marin"]);
  assert.ok(out.includes("Hilltop"), "first hop name present");
  assert.ok(out.includes("Bel Marin"), "last hop name present");
  assert.strictEqual(
    (out.match(/rarrow/g) || []).length, 2,
    "two styled arrows between three hops",
  );
});

test("unknown hops are counted honestly, never faked", () => {
  const out = routeDisplayName(["Hilltop", null, undefined]);
  assert.ok(out.includes("Hilltop"), "known hop keeps its name");
  assert.ok(out.includes("2 unnamed node(s)"), "unknown hops summarised");
  // and with no names at all the row still says something honest
  assert.strictEqual(routeDisplayName([null, null]), "via 2 node(s)");
  assert.strictEqual(routeDisplayName([]), "unnamed route");
});

test("S1: hostile names are escaped, not executable", () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const out = routeDisplayName([hostile, "ok"]);
  assert.ok(!out.includes("<img"), "no raw tag survives");
  assert.ok(out.includes("&lt;img"), "name is entity-escaped");
  const quote = routeDisplayName(['\" onmouseover=\"x']);
  assert.ok(!quote.includes('" onmouseover'), "attribute break-out escaped");
});

runIfMain();
