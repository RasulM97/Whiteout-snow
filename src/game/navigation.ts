import PF from "pathfinding";
import { GAME } from "./config";
import type { CircleZone } from "./snow";

export interface NavPoint { x: number; z: number }

/** Static obstacle grid rebuilt on construction changes; routes are smoothed by line of sight. */
export class RobotNavigation {
  readonly cell = 1.3;
  readonly dimension = Math.ceil(GAME.worldSize / this.cell);
  private matrix: number[][] = [];
  private revision = 0;
  private readonly finder = new PF.AStarFinder({ allowDiagonal: true, dontCrossCorners: true, heuristic: PF.Heuristic.euclidean });

  rebuild(obstacles: CircleZone[]): void {
    const n = this.dimension;
    this.matrix = Array.from({ length: n }, () => Array<number>(n).fill(0));
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
      const p = this.toWorld(col, row);
      if (Math.abs(p.x) > GAME.worldLimit - 0.8 || Math.abs(p.z) > GAME.worldLimit - 0.8) this.matrix[row][col] = 1;
      else for (const o of obstacles) {
        if (Math.hypot(p.x - o.x, p.z - o.z) < o.r + 0.82) { this.matrix[row][col] = 1; break; }
      }
    }
    this.revision++;
  }

  get version(): number { return this.revision; }
  private toCell(x: number, z: number): { col: number; row: number } {
    return {
      col: Math.max(0, Math.min(this.dimension - 1, Math.floor((x + GAME.worldSize / 2) / this.cell))),
      row: Math.max(0, Math.min(this.dimension - 1, Math.floor((z + GAME.worldSize / 2) / this.cell))),
    };
  }
  private toWorld(col: number, row: number): NavPoint {
    return { x: -GAME.worldSize / 2 + (col + 0.5) * this.cell, z: -GAME.worldSize / 2 + (row + 0.5) * this.cell };
  }
  private nearestOpen(col: number, row: number): { col: number; row: number } | null {
    if (this.matrix[row]?.[col] === 0) return { col, row };
    for (let radius = 1; radius <= 5; radius++) {
      let best: { col: number; row: number } | null = null;
      let bestD = Number.POSITIVE_INFINITY;
      for (let y = row - radius; y <= row + radius; y++) for (let x = col - radius; x <= col + radius; x++) {
        if (x < 0 || y < 0 || x >= this.dimension || y >= this.dimension || this.matrix[y][x] !== 0) continue;
        if (Math.max(Math.abs(x - col), Math.abs(y - row)) !== radius) continue;
        const d = (x - col) ** 2 + (y - row) ** 2;
        if (d < bestD) { bestD = d; best = { col: x, row: y }; }
      }
      if (best) return best;
    }
    return null;
  }
  private walkable(x: number, z: number): boolean {
    const c = this.toCell(x, z); return this.matrix[c.row]?.[c.col] === 0;
  }
  lineClear(a: NavPoint, b: NavPoint): boolean {
    const length = Math.hypot(b.x - a.x, b.z - a.z); const steps = Math.max(1, Math.ceil(length / 0.48));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps; if (!this.walkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  findPath(start: NavPoint, goal: NavPoint): NavPoint[] {
    const s0 = this.toCell(start.x, start.z), g0 = this.toCell(goal.x, goal.z);
    const s = this.nearestOpen(s0.col, s0.row), g = this.nearestOpen(g0.col, g0.row);
    if (!s || !g) return [];
    const safeStart = this.walkable(start.x, start.z) ? start : this.toWorld(s.col, s.row);
    const safeGoal = this.walkable(goal.x, goal.z) ? goal : this.toWorld(g.col, g.row);
    if (this.lineClear(safeStart, safeGoal)) return [{ x: safeGoal.x, z: safeGoal.z }];
    const grid = new PF.Grid(this.matrix.map((row) => row.slice()));
    const raw = this.finder.findPath(s.col, s.row, g.col, g.row, grid);
    if (!raw.length) return [];
    const points = raw.map(([col, row]) => this.toWorld(col, row));
    const smoothed: NavPoint[] = []; let anchor = start; let index = 0;
    while (index < points.length) {
      let furthest = index;
      for (let j = points.length - 1; j > index; j--) if (this.lineClear(anchor, points[j])) { furthest = j; break; }
      const point = points[furthest]; smoothed.push(point); anchor = point; index = furthest + 1;
    }
    return smoothed;
  }
}
