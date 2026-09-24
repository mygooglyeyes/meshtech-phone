/**
 * Area map renderer - the geographic picture of the host's coverage
 * square. Replaces the old abstract NxN button grid (a placeholder).
 *
 * Pure SVG in degree-space (x = lon). SVG's y axis grows DOWNWARD but
 * latitude grows NORTHWARD, so every y goes through fy(): a reflection
 * about the square's mid-latitude that puts north at the top. Grid
 * sections are numbered ROW-MAJOR FROM THE NORTH-WEST CORNER (the
 * grid.ts contract mirrored from the host), so row 0 = top row.
 *
 * No map tiles, no libraries: the LAYOUT gives the real square (center
 * + span), INTRO entries give real node positions.
 *
 * Look (Brett, 2026-09-18): hard-outlined coverage square, thin grid
 * lines, BIG ghost section numerals (hard outline, gradient fading
 * inwards from the edge), node dots at true positions, per-section
 * node counts small in each cell's corner, a subtle glow on busier
 * sections. Tapping a section still drills into its detail.
 *
 * SECURITY: node names come off the air - they only ever reach the
 * DOM through esc() inside <title> tooltips.
 */

import { esc } from "./esc.ts";
import { COAST_BBOX, LAND_RINGS } from "./coastdata.ts";

export interface MapNode {
  lat: number | null;
  lon: number | null;
  name?: string | null;
  nodeClass?: number | null;
}

export interface AreaMapOpts {
  grid: number;
  west: number;
  south: number;
  spanDeg: number;
  /** Active-node count per section (null = unknown, shown honestly). */
  counts: (number | null)[];
  nodes: MapNode[];
  /** Show the big ghost numerals? (Brett 2026-09-18: toggleable -
   * grid lines and corner counts stay visible when this is off.) */
  showSectionNumbers?: boolean;
}

/**
 * Section-detail map: the SAME geographic look as the area map -
 * coastline backdrop, node dots, coverage outline - zoomed to ONE
 * section, with no grid and no ghost numerals. The section's own
 * bounds get a stronger outline; the rest of the coverage square
 * stays visible but dimmed for context.
 */
export function sectionMapSvg(o: {
  sectionId: number;   // v1.2: 1-based wire id; printed as-is (no +1)
  west: number; south: number; east: number; north: number;
  squareWest: number; squareSouth: number; squareSpan: number;
  nodes: MapNode[];
  /** Routes to pre-draw as hidden ghost paths, revealed on list hover. */
  hoverRoutes?: { routeId: number; points: { lon: number; lat: number }[] }[];
}): string {
  const { sectionId, west, south, east, north } = o;
  const w = east - west, h = north - south;
  // Tight frame (Brett 2026-09-18): the section square fills the view;
  // only a thin margin outside it.
  const pad = w * 0.02;
  const vb = `${west - pad} ${south - pad} ${w + 2 * pad} ${h + 2 * pad}`;
  // SVG y grows downward; latitude grows northward. Reflection about
  // the section's mid-latitude puts north at the top of THIS view.
  const ref = (lat: number): number => north + south - lat;

  // Land/water backdrop over the whole viewBox (water rect first,
  // then baked land polygons on top - the same recipe as the area map).
  const backdrop = (
    `<rect class="water" x="${west - pad}" y="${south - pad}" ` +
    `width="${w + 2 * pad}" height="${h + 2 * pad}"/>` +
    LAND_RINGS.map((ring) =>
      `<polygon class="land" points="${
        ring.map(([lon, lat]) => `${lon},${ref(lat)}`).join(" ")}"/>`).join(""));

  // The rest of the coverage square, dimmed for context.
  const sqDim = (
    `<rect class="sqdim" x="${o.squareWest}" y="${o.squareSouth}" ` +
    `width="${o.squareSpan}" height="${o.squareSpan}"/>`);

  // This section's outline (the star of the view) + its nodes.
  const dots = o.nodes
    .filter((n) => n.lat != null && n.lon != null)
    .map((n) => {
      const cls = n.nodeClass === 1 ? "dot-repeater"
        : n.nodeClass === 2 ? "dot-companion" : "dot-unknown";
      const title = n.name ? `<title>${esc(n.name)}</title>` : "";
      // Section-detail dots: 2x the area-map dots (Brett 2026-09-18).
      return `<circle class="dot ${cls}" cx="${n.lon}" cy="${ref(n.lat!)}" r="${w * 0.016}">${title}</circle>`;
    }).join("");

  // Hidden ghost paths for the routes list: shown when the matching
  // row is hovered (JS toggles .show). vector-effect keeps the stroke
  // a screen-pixel width no matter the zoom.
  const ghosts = (o.hoverRoutes ?? []).map((r) =>
    `<g class="route-ghost" data-for="${r.routeId}">` +
    `<polyline vector-effect="non-scaling-stroke" points="${
      r.points.map((p) => `${p.lon},${ref(p.lat)}`).join(" ")}"/>` +
    r.points.map((p) =>
      `<circle cx="${p.lon}" cy="${ref(p.lat)}" r="${w * 0.006}"/>`).join("") +
    `</g>`).join("");

  return `<svg class="areamap sectionmap" viewBox="${vb}" role="img" ` +
    `aria-label="Section ${sectionId} detail map">
    ${backdrop}
    ${sqDim}
    <rect class="sectbounds" x="${west}" y="${south}" width="${w}" height="${h}"/>
    ${dots}
    ${ghosts}
  </svg>`;
}

/**
 * DOT LEGEND (Brett, 2026-09-23): tiny text + color dot above the map,
 * naming the three node classes the dots encode. The colors come from
 * the same CSS variables the dots themselves use (style.css .dot-*),
 * so legend and map can never disagree.
 */
export function dotLegend(): string {
  const item = (color: string, label: string): string =>
    `<span class="dotlegend-item"><span class="dotlegend-dot" ` +
    `style="background:${color}"></span>${label}</span>`;
  return `<div class="dotlegend">` +
    item("var(--good)", "repeater") +
    item("var(--accent)", "companion") +
    item("var(--muted)", "class unknown") +
    `</div>`;
}

export function areaMapSvg(o: AreaMapOpts): string {
  const { grid, west, south, spanDeg: span } = o;
  const north = south + span;
  const cell = span / grid;
  // Flush border (Brett 2026-09-18): the coverage square's outline
  // reaches the edge of the map display - just enough room that the
  // stroke itself isn't clipped.
  const pad = span * 0.002;
  const vb = `${west - pad} ${south - pad} ${span + 2 * pad} ${span + 2 * pad}`;
  // NORTH IS UP: screen-y for a latitude. fy(north) = south (top of
  // the viewBox), fy(south) = north (bottom). Pinned by areamap.test.
  const fy = (lat: number): number => north + south - lat;

  // Heat glow per section: busier cell gets a faint accent wash.
  const realCounts = o.counts.filter((c): c is number => c != null);
  const maxCount = Math.max(1, ...realCounts);
  const heat = (i: number): string => {
    const c = o.counts[i];
    if (c == null || c <= 0) return "";
    const a = (0.03 + 0.12 * (c / maxCount)).toFixed(3);
    const row = Math.floor(i / grid);
    const col = i % grid;
    const x = west + col * cell;
    const y = south + row * cell; // row 0 = NW = top
    return `<rect class="heat" x="${x}" y="${y}" width="${cell}" height="${cell}" opacity="${a}"/>`;
  };

  // Internal grid lines (thin).
  const lines: string[] = [];
  for (let i = 1; i < grid; i++) {
    const p = west + i * cell;
    const q = south + i * cell;
    lines.push(
      `<line class="gridline" x1="${p}" y1="${south}" x2="${p}" y2="${north}" stroke-width="${span * 0.0015}"/>`,
      `<line class="gridline" x1="${west}" y1="${fy(q)}" x2="${west + span}" y2="${fy(q)}" stroke-width="${span * 0.0015}"/>`,
    );
  }

  // Ghost numerals: hard outline + faint fill (Brett's ghost look).
  // DELIBERATELY no url(#gradient) paint server: a single shared
  // gradient referenced by many text elements mis-rendered as a solid
  // gray rectangle on some engines (the 2026-09-18 gray-block bug).
  // Row 0 = NW = top row. PROTOCOL v1.2: the numeral IS the wire id
  // (1-based everywhere, Brett 2026-09-20) - no +1 at render time.
  // Toggleable (showSectionNumbers, default ON for compatibility);
  // halved prominence 2026-09-18.
  const numerals: string[] = [];
  if (o.showSectionNumbers !== false) {
    for (let i = 1; i <= grid * grid; i++) {
      const row = Math.floor((i - 1) / grid);
      const col = (i - 1) % grid;
      const cx = west + col * cell + cell / 2;
      const cy = south + row * cell + cell / 2;
      numerals.push(
        `<text class="ghost" x="${cx}" y="${cy}" font-size="${cell * 0.31}" ` +
        `stroke-width="${cell * 0.006}" text-anchor="middle" dominant-baseline="central">${i}</text>`);
    }
  }

  // Node dots at true positions (positionless nodes are never drawn).
  const dots = o.nodes
    .filter((n) => n.lat != null && n.lon != null)
    .map((n) => {
      const cls = n.nodeClass === 1 ? "dot-repeater"
        : n.nodeClass === 2 ? "dot-companion" : "dot-unknown";
      const title = n.name ? `<title>${esc(n.name)}</title>` : "";
      return `<circle class="dot ${cls}" cx="${n.lon}" cy="${fy(n.lat!)}" r="${span * 0.006}">${title}</circle>`;
    })
    .join("");

  // Per-section counts, small in each cell's NW corner. "?" = unknown.
  const counts = o.counts.map((c, i) => {
    const row = Math.floor(i / grid);
    const col = i % grid;
    const x = west + col * cell + cell * 0.08;
    const y = south + row * cell + cell * 0.16;
    return `<text class="cellcount" x="${x}" y="${y}" font-size="${cell * 0.11}" ` +
      `stroke-width="${cell * 0.03}">${c == null ? "?" : c}</text>`;
  }).join("");

  // Clickable cells LAST so taps land on the section, not the dots.
  const cells: string[] = [];
  for (let i = 1; i <= grid * grid; i++) {
    const row = Math.floor((i - 1) / grid);
    const col = (i - 1) % grid;
    const x = west + col * cell;
    const y = south + row * cell;
    cells.push(`<rect class="cell" data-section="${i}" x="${x}" y="${y}" width="${cell}" height="${cell}"/>`);
  }

  // Land/water backdrop (baked Natural Earth land, public domain):
  // the svg background IS the water; land polygons drawn on top. The
  // backdrop covers a wider window than the coverage square so the
  // shoreline context survives pan/zoom later. Ring fill-rule handles
  // any hole rings; none exist in the baked data today.
  const backdrop = (
    `<rect class="water" x="${COAST_BBOX.west}" y="${fy(COAST_BBOX.north)}" ` +
    `width="${COAST_BBOX.east - COAST_BBOX.west}" ` +
    `height="${COAST_BBOX.north - COAST_BBOX.south}"/>` +
    LAND_RINGS.map((ring) =>
      `<polygon class="land" points="${
        ring.map(([lon, lat]) => `${lon},${fy(lat)}`).join(" ")}"/>`).join(""));

  return `<svg class="areamap" viewBox="${vb}" role="img" aria-label="Area coverage map, ${grid}x${grid} sections">
    ${backdrop}
    <rect class="cover" x="${west}" y="${south}" width="${span}" height="${span}" stroke-width="${span * 0.004}"/>
    ${o.counts.map((_, i) => heat(i)).join("")}
    ${lines.join("")}
    ${numerals.join("")}
    ${dots}
    ${counts}
    ${cells.join("")}
  </svg>`;
}
