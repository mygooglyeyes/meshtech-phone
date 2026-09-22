/**
 * Minimal HTML escaping for anything mesh-sourced that is interpolated
 * into innerHTML (layout names, node names from INTRO packets).
 *
 * Threat model (security review 2026-09-17): the #scope channel is
 * shared and the channel secret may be known to anyone who joins it.
 * Any string arriving over the air is ATTACKER-CONTROLLED. Never
 * interpolate wire strings into innerHTML without esc().
 *
 * Prefer textContent when rendering a value standalone; esc() is for
 * template strings that build HTML.
 */

const ESC_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESC_MAP[ch]);
}

/** esc() that tolerates null/undefined (renders nothing). */
export function escOr(value: string | null | undefined): string {
  return value ? esc(value) : "";
}
