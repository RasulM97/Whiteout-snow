import * as THREE from "three";
import { COLORS, GAME } from "./config";
import type { ChunkView } from "./types";

export interface CircleZone { x: number; z: number; r: number }

/** Shared visual/physics terrain. The station apron stays level; outer districts have real slopes. */
export function groundHeight(x: number, z: number): number {
  const broad = Math.sin(x * 0.105) * Math.cos(z * 0.092) * 0.72;
  const detail = Math.sin(x * 0.27 + z * 0.16) * 0.22 + Math.cos(z * 0.31 - x * 0.08) * 0.13;
  const baseDistance = Math.hypot(x - GAME.baseCenter.x, z - GAME.baseCenter.z);
  const blend = THREE.MathUtils.smoothstep(baseDistance, 10, 19);
  return (broad + detail) * blend - 0.06;
}

function mulberry32(a: number): () => number {
  return () => { a |= 0; a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export class SnowField {
  readonly resolution = 160;
  readonly size = GAME.worldSize;
  readonly mesh: THREE.Mesh;
  private density = new Float32Array(this.resolution * this.resolution);
  private pixels = new Uint8Array(this.resolution * this.resolution * 4);
  private texture: THREE.DataTexture;
  private material: THREE.MeshStandardMaterial;
  private geometry: THREE.PlaneGeometry;
  private random = mulberry32(GAME.seed);
  private exclusions: CircleZone[];
  totalRemaining = 0;
  private initialTotal = 1;
  readonly chunkColumns = 12;
  readonly chunkSize = this.size / this.chunkColumns;
  private chunkMass = new Float32Array(this.chunkColumns * this.chunkColumns);
  private chunkCells = new Uint16Array(this.chunkColumns * this.chunkColumns);
  private chunkDirty = new Uint8Array(this.chunkColumns * this.chunkColumns);
  private chunkCellIndices: Int32Array[];
  get cleanupPercent(): number { return THREE.MathUtils.clamp((1 - this.totalRemaining / this.initialTotal) * 100, 0, 100); }

  constructor(scene: THREE.Scene, exclusions: CircleZone[]) {
    this.exclusions = exclusions;
    const cells: number[][] = Array.from({ length: this.chunkColumns * this.chunkColumns }, () => []);
    for (let gy = 0; gy < this.resolution; gy++) for (let gx = 0; gx < this.resolution; gx++) {
      const wx = (gx + 0.5) / this.resolution * this.size - this.size / 2;
      const wz = this.size / 2 - (gy + 0.5) / this.resolution * this.size;
      cells[this.chunkAt(wx, wz)].push(gy * this.resolution + gx);
    }
    this.chunkCellIndices = cells.map((indices) => Int32Array.from(indices));
    this.texture = new THREE.DataTexture(this.pixels, this.resolution, this.resolution, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.minFilter = THREE.LinearFilter; this.texture.magFilter = THREE.LinearFilter; this.texture.generateMipmaps = false; this.texture.needsUpdate = true;
    this.geometry = new THREE.PlaneGeometry(this.size, this.size, this.resolution - 1, this.resolution - 1);
    const positions = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) positions.setZ(i, groundHeight(positions.getX(i), -positions.getY(i)));
    positions.needsUpdate = true; this.geometry.computeVertexNormals();
    this.material = new THREE.MeshStandardMaterial({
      color: COLORS.snow, roughness: 0.94, metalness: 0,
      alphaMap: this.texture, alphaTest: 0.1,
      displacementMap: this.texture, displacementScale: 0.78, displacementBias: 0.025,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2; this.mesh.position.y = 0.025;
    this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    scene.add(this.mesh); this.reset();
  }

  reset(): void {
    this.random = mulberry32(GAME.seed); this.totalRemaining = 0;
    for (let y = 0; y < this.resolution; y++) for (let x = 0; x < this.resolution; x++) {
      const i = y * this.resolution + x;
      const wx = (x + 0.5) / this.resolution * this.size - this.size / 2;
      const wz = this.size / 2 - (y + 0.5) / this.resolution * this.size;
      const wave = Math.sin(wx * 0.29 + wz * 0.19) * 0.09 + Math.cos(wz * 0.43 - wx * 0.12) * 0.06;
      let d = 0.72 + wave + this.random() * 0.18;
      const baseDist = Math.hypot(wx - GAME.baseCenter.x, wz - GAME.baseCenter.z);
      if (baseDist < 8) d *= THREE.MathUtils.smoothstep(baseDist, 3.5, 8);
      for (const zone of this.exclusions) if (Math.hypot(wx - zone.x, wz - zone.z) < zone.r) { d = 0; break; }
      this.density[i] = d; this.totalRemaining += d; this.writePixel(i, d);
    }
    this.initialTotal = Math.max(1, this.totalRemaining);
    this.chunkDirty.fill(1); this.texture.needsUpdate = true;
  }

  private writePixel(i: number, d: number): void {
    const v = Math.max(0, Math.min(255, Math.round(d * 255))); const p = i * 4;
    this.pixels[p] = v; this.pixels[p + 1] = v; this.pixels[p + 2] = v; this.pixels[p + 3] = 255;
  }
  private coords(x: number, z: number): { x: number; y: number } {
    return { x: Math.floor((x / this.size + 0.5) * this.resolution), y: Math.floor((0.5 - z / this.size) * this.resolution) };
  }
  sample(x: number, z: number): number {
    const c = this.coords(x, z);
    if (c.x < 0 || c.y < 0 || c.x >= this.resolution || c.y >= this.resolution) return 0;
    return this.density[c.y * this.resolution + c.x];
  }
  heightAt(x: number, z: number): number { const d = this.sample(x, z); return groundHeight(x, z) + 0.025 + (d > 0.1 ? d * 0.78 + 0.025 : 0); }

  clear(x: number, z: number, radius: number, amount: number): number {
    const c = this.coords(x, z); const rr = Math.ceil(radius / this.size * this.resolution) + 1;
    let removed = 0; let changed = false;
    for (let gy = Math.max(0, c.y - rr); gy <= Math.min(this.resolution - 1, c.y + rr); gy++) for (let gx = Math.max(0, c.x - rr); gx <= Math.min(this.resolution - 1, c.x + rr); gx++) {
      const wx = (gx + 0.5) / this.resolution * this.size - this.size / 2;
      const wz = this.size / 2 - (gy + 0.5) / this.resolution * this.size;
      const dist = Math.hypot(wx - x, wz - z); if (dist > radius) continue;
      const i = gy * this.resolution + gx; const before = this.density[i]; if (before <= 0) continue;
      const falloff = 0.35 + 0.65 * (1 - dist / radius);
      const next = Math.max(0, before - amount * falloff); const delta = before - next;
      if (delta <= 0) continue;
      this.density[i] = next; this.writePixel(i, next); removed += delta; changed = true;
      this.chunkDirty[this.chunkAt(wx, wz)] = 1;
    }
    if (changed) { this.totalRemaining = Math.max(0, this.totalRemaining - removed); this.texture.needsUpdate = true; }
    return removed;
  }

  private protectedAt(x: number, z: number, heaters: CircleZone[]): boolean {
    if (Math.hypot(x - GAME.baseCenter.x, z - GAME.baseCenter.z) < GAME.baseHeatRadius) return true;
    for (const zone of heaters) if (Math.hypot(x - zone.x, z - zone.z) < zone.r) return true;
    for (const zone of this.exclusions) if (Math.hypot(x - zone.x, z - zone.z) < zone.r) return true;
    return false;
  }

  stormBurst(heaters: CircleZone[]): number {
    let refilled = 0;
    for (let gy = 1; gy < this.resolution - 1; gy++) for (let gx = 1; gx < this.resolution - 1; gx++) {
      const i = gy * this.resolution + gx; const before = this.density[i];
      if (before > 0.1 || this.random() >= GAME.stormRegrowChance) continue;
      const wx = (gx + 0.5) / this.resolution * this.size - this.size / 2;
      const wz = this.size / 2 - (gy + 0.5) / this.resolution * this.size;
      if (this.protectedAt(wx, wz, heaters)) continue;
      const next = 0.28 + this.random() * 0.42;
      this.density[i] = next; this.writePixel(i, next); this.totalRemaining += next - before; refilled++;
    }
    if (refilled) { this.chunkDirty.fill(1); this.texture.needsUpdate = true; }
    return refilled;
  }

  regrow(dt: number, intensity: number, heaters: CircleZone[], focus?: { x: number; z: number; r: number }): void {
    // Continuous local precipitation is essential: a freshly cleared patch must not stay bare for a whole storm.
    const attempts = Math.max(2, Math.floor(1100 * dt * intensity)); let changed = false;
    for (let n = 0; n < attempts; n++) {
      let wx: number; let wz: number;
      if (focus && n % 3 !== 0) {
        const angle = this.random() * Math.PI * 2; const radius = Math.sqrt(this.random()) * focus.r;
        wx = focus.x + Math.sin(angle) * radius; wz = focus.z + Math.cos(angle) * radius;
      } else {
        wx = (this.random() - 0.5) * this.size; wz = (this.random() - 0.5) * this.size;
      }
      const c = this.coords(wx, wz);
      if (c.x < 0 || c.y < 0 || c.x >= this.resolution || c.y >= this.resolution || this.protectedAt(wx, wz, heaters)) continue;
      const i = c.y * this.resolution + c.x; const before = this.density[i]; if (before >= 0.82) continue;
      const neighborAverage = c.x > 0 && c.y > 0 && c.x < this.resolution - 1 && c.y < this.resolution - 1
        ? (this.density[i - 1] + this.density[i + 1] + this.density[i - this.resolution] + this.density[i + this.resolution]) * 0.25
        : before;
      // Grow a coherent thin edge from neighbouring snow instead of isolated bright pixels.
      const coherentBase = Math.max(before, Math.min(0.42, neighborAverage * 0.7));
      const next = Math.min(0.82, coherentBase + 0.012 * intensity); this.totalRemaining += next - before;
      this.density[i] = next; this.writePixel(i, next); changed = true;
      this.chunkDirty[this.chunkAt(wx, wz)] = 1;
    }
    if (changed) this.texture.needsUpdate = true;
  }

  melt(dt: number, heaters: CircleZone[]): number {
    let removed = 0;
    for (const zone of heaters) if (zone.r > 0) removed += this.clear(zone.x, zone.z, zone.r, dt * 0.12);
    return removed;
  }

  findDenseDistrict(x: number, z: number, radius: number, district: number): { x: number; z: number; density: number } | null {
    const sector = Math.PI / 3; const center = district * sector;
    for (let n = 0; n < 30; n++) {
      const a = center + (this.random() - 0.5) * sector * 0.9; const r = 2 + Math.sqrt(this.random()) * (radius - 2);
      const wx = x + Math.sin(a) * r; const wz = z + Math.cos(a) * r; const d = this.sample(wx, wz);
      if (d > 0.25) return { x: wx, z: wz, density: d };
    }
    return null;
  }

  findDense(x: number, z: number, radius: number): { x: number; z: number; density: number } | null {
    return this.findBestPatch(x, z, radius);
  }

  /** Deterministic patch scoring: nearby contiguous snow wins over isolated post-storm specks and distant targets. */
  findBestPatch(x: number, z: number, radius: number, avoid: Array<{ x: number; z: number }> = []): { x: number; z: number; density: number; score: number } | null {
    const min = this.coords(x - radius, z + radius); const max = this.coords(x + radius, z - radius);
    let best: { x: number; z: number; density: number; score: number } | null = null;
    for (let gy = Math.max(1, min.y); gy <= Math.min(this.resolution - 2, max.y); gy++) {
      for (let gx = Math.max(1, min.x); gx <= Math.min(this.resolution - 2, max.x); gx++) {
        const center = this.density[gy * this.resolution + gx]; if (center < 0.1) continue;
        const wx = (gx + 0.5) / this.resolution * this.size - this.size / 2;
        const wz = this.size / 2 - (gy + 0.5) / this.resolution * this.size;
        const distance = Math.hypot(wx - x, wz - z); if (distance > radius) continue;
        if (avoid.some((point) => Math.hypot(wx - point.x, wz - point.z) < 2.8)) continue;
        let mass = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) mass += this.density[(gy + oy) * this.resolution + gx + ox];
        if (mass < 0.5) continue;
        const score = mass * 2.4 + center - distance * 0.022;
        if (!best || score > best.score + 0.0001) best = { x: wx, z: wz, density: center, score };
      }
    }
    return best;
  }

  chunkAt(x: number, z: number): number {
    const col = Math.max(0, Math.min(this.chunkColumns - 1, Math.floor((x + this.size / 2) / this.chunkSize)));
    const row = Math.max(0, Math.min(this.chunkColumns - 1, Math.floor((z + this.size / 2) / this.chunkSize)));
    return row * this.chunkColumns + col;
  }
  chunkCenter(id: number): { x: number; z: number } {
    const col = id % this.chunkColumns; const row = Math.floor(id / this.chunkColumns);
    return { x: -this.size / 2 + (col + 0.5) * this.chunkSize, z: -this.size / 2 + (row + 0.5) * this.chunkSize };
  }
  private measureChunk(id: number): void {
    if (!this.chunkDirty[id]) return;
    const indices = this.chunkCellIndices[id]; let mass = 0;
    for (const index of indices) mass += this.density[index];
    this.chunkMass[id] = mass; this.chunkCells[id] = indices.length; this.chunkDirty[id] = 0;
  }
  chunkView(id: number): ChunkView {
    this.measureChunk(id); const center = this.chunkCenter(id); const col = id % this.chunkColumns; const row = Math.floor(id / this.chunkColumns);
    const full = Math.max(1, this.chunkCells[id] * 0.82);
    return { id, name: `${String.fromCharCode(65 + col)}-${String(row + 1).padStart(2, "0")}`, col, row, x: center.x, z: center.z, size: this.chunkSize, remaining: this.chunkMass[id], progress: THREE.MathUtils.clamp(1 - this.chunkMass[id] / full, 0, 1), assigned: false };
  }
  chunkViews(): ChunkView[] { return Array.from({ length: this.chunkColumns * this.chunkColumns }, (_, id) => this.chunkView(id)); }
  findBestChunk(x: number, z: number, range: number, avoid: number[], fromX = x, fromZ = z): number | null {
    let best: number | null = null; let bestScore = 0.55;
    for (let id = 0; id < this.chunkMass.length; id++) {
      if (avoid.includes(id)) continue;
      const chunk = this.chunkView(id); if (chunk.remaining < 0.55) continue;
      if (Math.hypot(chunk.x - x, chunk.z - z) > range + this.chunkSize * 0.45) continue;
      const score = chunk.remaining * 0.065 - Math.hypot(chunk.x - fromX, chunk.z - fromZ) * 0.08;
      if (score > bestScore) { bestScore = score; best = id; }
    }
    return best;
  }
  findChunkTarget(id: number, fromX: number, fromZ: number): { x: number; z: number; density: number } | null {
    const center = this.chunkCenter(id); const half = this.chunkSize / 2;
    let best: { x: number; z: number; density: number; score: number } | null = null;
    for (const index of this.chunkCellIndices[id]) {
      const gx = index % this.resolution; const gy = Math.floor(index / this.resolution);
      if (gx < 1 || gy < 1 || gx >= this.resolution - 1 || gy >= this.resolution - 1) continue;
      const wx = (gx + 0.5) / this.resolution * this.size - this.size / 2;
      const wz = this.size / 2 - (gy + 0.5) / this.resolution * this.size;
      if (Math.abs(wx - center.x) >= half || Math.abs(wz - center.z) >= half) continue;
      const density = this.density[index]; if (density < 0.065) continue;
      let neighbors = 0; for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) neighbors += this.density[(gy + oy) * this.resolution + gx + ox];
      const score = density * 2 + neighbors * 0.45 - Math.hypot(wx - fromX, wz - fromZ) * 0.025;
      if (!best || score > best.score) best = { x: wx, z: wz, density, score };
    }
    return best;
  }

  serialize(): number[] { return Array.from(this.density, (v) => Math.round(v * 1000) / 1000); }
  restore(values: number[]): void {
    if (values.length !== this.density.length) return;
    this.totalRemaining = 0;
    for (let i = 0; i < values.length; i++) {
      const v = THREE.MathUtils.clamp(Number(values[i]) || 0, 0, 1);
      this.density[i] = v; this.totalRemaining += v; this.writePixel(i, v);
    }
    this.chunkDirty.fill(1); this.texture.needsUpdate = true;
  }
  dispose(scene: THREE.Scene): void { scene.remove(this.mesh); this.geometry.dispose(); this.material.dispose(); this.texture.dispose(); }
}
