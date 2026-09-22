/**
 * Section geometry - mirrors meshtech-scope/src/meshtech_scope/core/grid.py.
 * PROTOCOL v1.2 (2026-09-20): sections are numbered ROW-MAJOR FROM THE
 * NORTH-WEST CORNER, 1-BASED EVERYWHERE (wire, logs, UI):
 * 1 = NW, grid = NE, grid*grid = SE. Id 0 is RESERVED (whole-area marker
 * in refresh targets) and never a square - the old 0-based wire ids put
 * "section 0" in logs while screens showed "Section 1", which confused
 * humans (Brett 2026-09-20). The -1 "not on the map" answer is unchanged.
 */

export const METERS_PER_DEGREE = 111320.0;

export interface SectionRect {
  sectionId: number;
  col: number;
  row: number;
  west: number;
  east: number;
  south: number;
  north: number;
}

export class GridGeometry {
  readonly grid: number;
  readonly centerLat: number;
  readonly centerLon: number;
  readonly spanM: number;

  constructor(grid: number, centerLat: number, centerLon: number, spanM: number) {
    this.grid = grid;
    this.centerLat = centerLat;
    this.centerLon = centerLon;
    this.spanM = spanM;
  }

  get spanDeg(): number {
    return this.spanM / METERS_PER_DEGREE;
  }

  get west(): number { return this.centerLon - this.spanDeg / 2; }
  get east(): number { return this.centerLon + this.spanDeg / 2; }
  get north(): number { return this.centerLat + this.spanDeg / 2; }
  get south(): number { return this.centerLat - this.spanDeg / 2; }
  get sectionCount(): number { return this.grid * this.grid; }

  section(sectionId: number): SectionRect {
    if (sectionId < 1 || sectionId > this.sectionCount)
      throw new Error(`section_id out of range: ${sectionId}`);
    const row = Math.floor((sectionId - 1) / this.grid);
    const col = (sectionId - 1) % this.grid;
    const width = this.spanDeg / this.grid;
    const north = this.north - row * width;
    const south = north - width;
    const west = this.west + col * width;
    return { sectionId, col, row, west, east: west + width, south, north };
  }

  sectionFor(lat: number, lon: number): number {
    if (lat < this.south || lat > this.north || lon < this.west || lon > this.east)
      return -1;
    const width = this.spanDeg / this.grid;
    const col = Math.min(this.grid - 1, Math.floor((lon - this.west) / width));
    const row = Math.min(this.grid - 1, Math.floor((this.north - lat) / width));
    return row * this.grid + col + 1;
  }
}
