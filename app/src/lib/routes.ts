/**
 * Human route naming - Brett (2026-09-18): people do not memorize hex
 * route ids, so route rows read "Route 1 - [name] → [name]" with node
 * names and a styled graphical arrow between hops. The hex id stays
 * where it belongs (the route screen heading), never as the row label.
 *
 * Honest degradation: hops whose node name is unknown are summarised
 * ("2 unnamed node(s)") - never a fake name, never a bare hex id as
 * the label, and the row is never blank.
 *
 * SECURITY (S1, 2026-09-20 review): node names come OFF THE AIR -
 * anyone radio-adjacent can broadcast any name. This builder escapes
 * every name HERE, so every consumer (route rows, route heading) can
 * interpolate the result into HTML directly. The arrow is trusted
 * fixed markup.
 */

/** The arrow glyph between hops, as styled (graphical) markup. */
export const ROUTE_ARROW = ' <span class="rarrow">→</span> ';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;",
  }[c] as string));
}

export function routeDisplayName(
  hopNames: (string | null | undefined)[],
): string {
  const parts: string[] = [];
  let unnamed = 0;
  for (const n of hopNames) {
    if (n) parts.push(esc(n));
    else unnamed += 1;
  }
  if (parts.length === 0) {
    return unnamed > 0 ? `via ${unnamed} node(s)` : "unnamed route";
  }
  if (unnamed > 0) parts.push(`${unnamed} unnamed node(s)`);
  return parts.join(ROUTE_ARROW);
}
