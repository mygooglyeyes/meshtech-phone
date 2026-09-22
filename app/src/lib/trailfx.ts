/**
 * Trail effects - the outpost-inspired visuals (meshtech-scope TODOS #16).
 *
 * Fully client-side over data the feed already carries: no wire changes,
 * no per-frame JS loops after mount (SMIL animates inside the SVG), and
 * prefers-reduced-motion collapses everything to the final state.
 *
 * Aging states (mirrors waev:outpost's Link Desk behaviour):
 *   fresh   - heard recently: solid, full brightness
 *   fading  - quiet a while: same line, dimmed
 *   overdue - silent against its own rhythm: dashed, brighter than fading
 *   ghost   - past the window: dimmest, hollow dash, no pulse
 *
 * SECURITY (review 2026-09-17): everything interpolated into the pulse
 * markup below is a NUMBER from validated route/position fields - no
 * wire strings pass through here.
 */

export const AGING_FRESH_MS = 6 * 60 * 1000;
export const AGING_OVERDUE_MS = 30 * 60 * 1000;
export const AGING_GHOST_MS = 6 * 60 * 60 * 1000;

export type AgingState = "fresh" | "fading" | "overdue" | "ghost";

/** Short human label per state, shown beside the trail. */
export const AGING_LABEL: Record<AgingState, string> = {
  fresh: "live",
  fading: "quiet",
  overdue: "overdue",
  ghost: "ghost",
};

export interface TrailPoint {
  lon: number;
  lat: number;
}

export interface TrailFx {
  /** Classes to put on the svg.trail element. */
  cls: string;
  /** Pulse markup to insert inside the svg ("" when not animating). */
  pulse: string;
  /** The computed aging state, for an honest label next to the trail. */
  state: AgingState;
  /** Seconds the one-pass pulse runs (0 = no pulse). Callers use it
   * to schedule cleanup after a data-arrival replay. */
  durS: number;
}

/**
 * Replay the pulse for a LIVE data arrival: call when a fresh packet
 * for the route renders. Injects a one-pass moving dot into the trail
 * svg and removes it when done - the animation exists only when data
 * says something happened (Brett 2026-09-18).
 *
 * DRIVE-BY-JS, not SMIL: the old animateMotion markup silently did
 * nothing in browsers where the environment disables ambient motion
 * (Brett's box: reduced-motion ON - the element existed, the dot
 * never moved). requestAnimationFrame moves the dot ourselves, so
 * an explicit arrival ALWAYS animates regardless of OS settings.
 */
export function startTrailPulse(
  svg: SVGSVGElement,
  fx: TrailFx,
): void {
  if (!fx.pulse || fx.durS <= 0) return;
  svg.querySelector("circle.pulse")?.remove();
  // The pulse markup carries the (reflected) path geometry.
  const raw = fx.pulse.match(/path="([^"]+)"/);
  if (!raw) return;
  const path = raw[1].slice(2); // strip "M "
  const segs = path.split(" L ").map((pair) =>
    pair.split(",").map(Number) as [number, number]);
  if (segs.length < 2) return;

  // Total length per segment for even-time interpolation.
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < segs.length; i++) {
    const dx = segs[i][0] - segs[i - 1][0];
    const dy = segs[i][1] - segs[i - 1][1];
    const d = Math.hypot(dx, dy);
    lens.push(d);
    total += d;
  }
  const svgNS = "http://www.w3.org/2000/svg";
  const dot = document.createElementNS(svgNS, "circle");
  dot.setAttribute("class", "pulse");
  dot.setAttribute("r", "0.0025");
  dot.setAttribute("cx", String(segs[0][0]));
  dot.setAttribute("cy", String(segs[0][1]));
  svg.appendChild(dot);

  // COMET TAIL (Brett 2026-09-18): a train of dots trailing the
  // head, each smaller and fainter the further back it sits.
  // TAIL_LEN = fraction of the whole path the tail spans; Brett:
  // +300% (4x the original 0.06) and it must never reach past the
  // head's start position, so it's capped at 40% of the path.
  const TAIL_N = 7;
  const TAIL_LEN = 0.24; // fraction of the path the tail spans
  const tail: SVGCircleElement[] = [];
  for (let k = 0; k < TAIL_N; k++) {
    const c = document.createElementNS(svgNS, "circle");
    c.setAttribute("class", "pulsetail");
    c.setAttribute("r", String(0.0025 * (1 - (k + 1) / (TAIL_N + 1))));
    c.setAttribute("cx", String(segs[0][0]));
    c.setAttribute("cy", String(segs[0][1]));
    c.setAttribute("opacity", String(0.75 * (1 - (k + 1) / (TAIL_N + 1))));
    svg.appendChild(c);
    tail.push(c);
  }
  // Point at distance `dist` along the segs polyline.
  const pointAt = (dist: number): [number, number] => {
    const d = Math.max(0, Math.min(total, dist));
    let remaining = d;
    let i = 0;
    while (i < lens.length - 1 && remaining > lens[i]) {
      remaining -= lens[i];
      i += 1;
    }
    const seg = Math.min(1, lens[i] > 0 ? remaining / lens[i] : 1);
    return [
      segs[i][0] + (segs[i + 1][0] - segs[i][0]) * seg,
      segs[i][1] + (segs[i + 1][1] - segs[i][1]) * seg,
    ];
  };

  const t0 = performance.now();
  const durMs = fx.durS * 1000;
  const tick = (t: number): void => {
    const frac = Math.min(1, (t - t0) / durMs);
    const dist = frac * total;
    const [hx, hy] = pointAt(dist);
    dot.setAttribute("cx", String(hx));
    dot.setAttribute("cy", String(hy));
    // Tail dots sit BEHIND the head along the path (never ahead),
    // each fading with distance behind the comet head.
    for (let k = 0; k < tail.length; k++) {
      const [tx, ty] = pointAt(dist - (TAIL_LEN * total * (k + 1)) / TAIL_N);
      tail[k].setAttribute("cx", String(tx));
      tail[k].setAttribute("cy", String(ty));
      tail[k].setAttribute("opacity", String(0.75 * (1 - (k + 1) / (TAIL_N + 1))));
    }
    if (frac < 1) {
      requestAnimationFrame(tick);
    } else {
      dot.remove();
      tail.forEach((c) => c.remove());
    }
  };
  requestAnimationFrame(tick);
}

/**
 * Classify a route by how long it has been silent.
 * `lastHeardMs` is the absolute timestamp of the last packet on the
 * route (null = never heard -> ghost). Bands: <=6 min fresh, <=30 min
 * fading, <=6 h overdue, else ghost.
 */
export function agingState(
  lastHeardMs: number | null,
  now: number = Date.now(),
): AgingState {
  if (lastHeardMs == null) return "ghost";
  const age = Math.max(0, now - lastHeardMs);
  if (age <= AGING_FRESH_MS) return "fresh";
  if (age <= AGING_OVERDUE_MS) return "fading";
  if (age <= AGING_GHOST_MS) return "overdue";
  return "ghost";
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Effects for one route trail: the svg's aging class and, when the
 * route is alive and the user allows motion, a pulse that travels the
 * polyline node-to-node (SMIL animateMotion - the browser animates,
 * we run no JS per frame). Duration scales with hop count.
 */
export function trailFx(opts: {
  points: TrailPoint[];
  lastHeardMin: number | null;
  now?: number;
  reducedMotion?: boolean;
  /** Play the pulse? Default OFF: the dot only moves when LIVE data
   * for the route arrives (Brett 2026-09-18) - the trail is a data
   * readout, not a screensaver. Renderers call startTrailPulse() on
   * arrival instead of asking for a looping animation here. */
  play?: boolean;
}): TrailFx {
  const now = opts.now ?? Date.now();
  const lastHeardMs = opts.lastHeardMin == null
    ? null
    : now - opts.lastHeardMin * 60_000;
  const state = agingState(lastHeardMs, now);
  const reduced = prefersReducedMotion();

  // Animate only live routes with at least two positioned hops - a
  // single point has no path to travel and a ghost route is silent.
  const animate = opts.play === true && opts.points.length >= 2 &&
    state !== "ghost";
  let pulse = "";
  if (animate) {
    // The motion path MUST use the same screen space as the drawn
    // polyline: reflect latitude inside the points' own span (SVG y
    // grows downward; Brett caught the dot flying the mirrored route,
    // 2026-09-18). Same fy() convention as the renderers.
    const lats = opts.points.map((p) => p.lat);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const fy = (lat: number): number => maxLat + minLat - lat;
    const path = "M " +
      opts.points.map((p) => `${p.lon},${fy(p.lat)}`).join(" L ");
    // One pass per data arrival. Brett (2026-09-18): the head should
    // cross the WHOLE path in about half to three-quarters of a
    // second, whatever the hop count - so the duration is clamped to
    // [0.5, 0.75]s with a slight length allowance.
    const dur = Math.min(0.75, Math.max(0.5, 0.35 + opts.points.length * 0.08));
    pulse =
      `<circle class="pulse" r="0.0025">` +
      `<animateMotion dur="${dur}s" repeatCount="1" ` +
      `path="${path}"/></circle>`;
  }
  return {
    cls: `trail aging-${state}`,
    pulse,
    state,
    durS: animate
      ? Math.min(0.75, Math.max(0.5, 0.35 + opts.points.length * 0.08))
      : 0,
  };
}
