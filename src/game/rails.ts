import * as THREE from "three";
import type { CargoKind } from "./types";
import { disposeObject } from "./resources";
import { COLORS, GAME } from "./config";
import { BuildingSystem } from "./buildings";
import { mesh } from "./world";
import { groundHeight } from "./snow";
import { RailNetwork } from "./rail-network";

export interface RailPathPoint { x: number; z: number }
interface CapsuleEntity {
  group: THREE.Group; cargoVisual: THREE.Group; active: boolean; cargo: number;
  distance: number; wait: number; travel: number; capacity: number;
}
interface TravelPath { points: RailPathPoint[]; lengths: number[]; total: number }
export interface RailEntity {
  sourceId: number; destinationId: number; path: RailPathPoint[]; travel: RailPathPoint[]; lengths: number[]; total: number;
  group: THREE.Group; capsules: CapsuleEntity[]; kind: CargoKind; dispatch: number; railY: number;
  lane: number; paid: number; routed: boolean;
}
export interface RailSave {
  sourceId: number; destinationId: number; path: RailPathPoint[];
  lane?: number; paid?: number; routed?: boolean;
  capsules?: Array<{ active: boolean; cargo: number; distance: number; wait: number; travel: number }>;
}

const LANE_COLORS = [0x7ae5e2, 0xffc56a, 0x9ecbff, 0xd6b0ff, 0xff9e8a];

/** Elevated magnetic guideway with autonomous one-way freight capsules. */
export class RailSystem {
  readonly group = new THREE.Group(); readonly items: RailEntity[] = [];
  readonly network: RailNetwork;
  private tmp = new THREE.Vector3();
  constructor(
    private scene: THREE.Scene,
    private buildings: BuildingSystem,
    private sell: (kind: CargoKind, amount: number, byRail: boolean) => void,
    private delivered: (kind: CargoKind, amount: number) => void,
  ) { scene.add(this.group); this.network = new RailNetwork(this.group, buildings, sell, delivered); }

  static pathFor(x: number, z: number, destinationX: number = GAME.depot.x, destinationZ: number = GAME.depot.z - 1.7): RailPathPoint[] {
    const path = [{ x, z }];
    if (Math.abs(x - destinationX) > 3 && Math.abs(z - destinationZ) > 3) path.push({ x, z: destinationZ });
    path.push({ x: destinationX, z: destinationZ }); return path;
  }
  static pathLength(path: RailPathPoint[]): number {
    let total = 0; for (let i = 1; i < path.length; i++) total += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z); return total;
  }
  static price(length: number): number { return Math.max(24, Math.ceil(length * 2.2)); }
  /** Straight runs stay straight. Corners get a short fillet. Lanes separate in the middle and meet again at each building. */
  static shape(controls: RailPathPoint[], lane: number): TravelPath {
    const clean: RailPathPoint[] = [];
    for (const point of controls) {
      const prev = clean[clean.length - 1];
      if (!prev || Math.hypot(point.x - prev.x, point.z - prev.z) > 0.2) clean.push({ x: point.x, z: point.z });
    }
    if (clean.length < 2) return { points: clean, lengths: [0], total: 0 };
    const samples: RailPathPoint[] = [clean[0]];
    for (let i = 1; i < clean.length - 1; i++) {
      const prev = clean[i - 1], corner = clean[i], next = clean[i + 1];
      const inLen = Math.hypot(corner.x - prev.x, corner.z - prev.z);
      const outLen = Math.hypot(next.x - corner.x, next.z - corner.z);
      const pull = Math.min(1.65, inLen * 0.42, outLen * 0.42);
      if (pull < 0.4 || inLen < 0.001 || outLen < 0.001) { samples.push(corner); continue; }
      const ax = corner.x - (corner.x - prev.x) / inLen * pull;
      const az = corner.z - (corner.z - prev.z) / inLen * pull;
      const bx = corner.x + (next.x - corner.x) / outLen * pull;
      const bz = corner.z + (next.z - corner.z) / outLen * pull;
      samples.push({ x: ax, z: az });
      for (let step = 1; step <= 4; step++) {
        const t = step / 5, u = 1 - t;
        samples.push({ x: u * u * ax + 2 * u * t * corner.x + t * t * bx, z: u * u * az + 2 * u * t * corner.z + t * t * bz });
      }
      samples.push({ x: bx, z: bz });
    }
    samples.push(clean[clean.length - 1]);
    const dense: RailPathPoint[] = [samples[0]];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      const span = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(span / 1.6));
      for (let step = 1; step <= steps; step++) dense.push({ x: a.x + (b.x - a.x) * step / steps, z: a.z + (b.z - a.z) * step / steps });
    }
    const base = RailSystem.measure(dense);
    const slot = ((lane % 5) + 5) % 5;
    const midShift = slot * 0.95;
    const endSide = (slot - 2) * 0.28;
    const edge = Math.min(4.2, Math.max(0.8, base.total * 0.34));
    const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
    const last = base.points.length - 1;
    const points = base.points.map((point, index) => {
      const dist = base.lengths[index] ?? 0;
      const fade = Math.min(smooth(dist / edge), smooth((base.total - dist) / edge));
      const a = base.points[Math.max(0, index - 1)], b = base.points[Math.min(last, index + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
      const lateral = midShift * fade + endSide * (1 - fade);
      return { x: point.x + -dz / len * lateral, z: point.z + dx / len * lateral };
    });
    return RailSystem.measure(points);
  }
  static blocked(points: RailPathPoint[], obstacles: Array<{ x: number; z: number; radius: number }>, source: RailPathPoint, dest: RailPathPoint): boolean {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(len));
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        if (Math.hypot(x - source.x, z - source.z) < 2.8 || Math.hypot(x - dest.x, z - dest.z) < 2.8) continue;
        if (obstacles.some((obstacle) => Math.hypot(x - obstacle.x, z - obstacle.z) < obstacle.radius + 0.55)) return true;
      }
    }
    return false;
  }
  private static measure(points: RailPathPoint[]): TravelPath {
    const lengths = [0]; let total = 0;
    for (let i = 1; i < points.length; i++) { total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z); lengths.push(total); }
    return { points, lengths, total };
  }
  private compatible(kind: CargoKind, destinationId: number): boolean {
    if (destinationId === 0) return kind === "purified" || kind === "ice";
    const destination = this.buildings.byId(destinationId);
    return !!destination && ((kind === "raw" && destination.type === "purifier") || (kind === "purified" && destination.type === "press"));
  }
  nextLane(): number { return this.items.length % 5; }
  quote(controls: RailPathPoint[], lane: number, routed = true): { points: RailPathPoint[]; total: number; cost: number } {
    const shaped = routed ? RailSystem.shape(controls, lane) : RailSystem.measure(controls.map((point) => ({ ...point })));
    return { points: shaped.points, total: shaped.total, cost: RailSystem.price(shaped.total) };
  }
  find(sourceId: number, destinationId: number): RailEntity | undefined {
    return this.items.find((route) => route.sourceId === sourceId && route.destinationId === destinationId);
  }
  hit(x: number, z: number, range = 1.4): RailEntity | null {
    let best: RailEntity | null = null, bestD = range;
    for (const route of this.items) {
      for (let i = 1; i < route.travel.length; i++) {
        const a = route.travel[i - 1], b = route.travel[i];
        const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
        const t = len2 < 1e-6 ? 0 : THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
        const dist = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
        if (dist < bestD) { best = route; bestD = dist; }
      }
    }
    return best;
  }

  create(sourceId: number, destinationId: number, path: RailPathPoint[], charge: (cost: number) => boolean, restored = false, options?: { lane?: number; routed?: boolean; paid?: number }): RailEntity | null {
    const source = this.buildings.byId(sourceId); const kind = source ? this.buildings.cargoKind(source) : null;
    if (!source || !kind || !this.compatible(kind, destinationId) || sourceId === destinationId || this.find(sourceId, destinationId)) return null;
    if (path.length < 2 || RailSystem.pathLength(path) < 2) return null;
    const routed = options?.routed ?? !restored;
    const lane = options?.lane ?? (restored ? 0 : this.nextLane());
    const shaped = routed ? RailSystem.shape(path, lane) : RailSystem.measure(path.map((point) => ({ ...point })));
    if (shaped.total < 2) return null;
    const cost = RailSystem.price(shaped.total);
    if (!restored && !charge(cost)) return null;
    const group = new THREE.Group(); group.name = `maglev-${sourceId}-${destinationId}`; this.group.add(group);
    const entity: RailEntity = {
      sourceId, destinationId, path: path.map((point) => ({ ...point })), travel: shaped.points, lengths: shaped.lengths, total: shaped.total,
      group, capsules: [], kind, dispatch: 0.25, railY: 1, lane, paid: options?.paid ?? cost, routed,
    };
    this.paint(entity); this.items.push(entity); return entity;
  }

  /** Rebuild one route in place. A longer path pays only the increase. A shorter path never refunds. */
  retarget(route: RailEntity, controls: RailPathPoint[], charge: (cost: number) => boolean): boolean {
    const shaped = RailSystem.shape(controls, route.lane);
    if (shaped.points.length < 2 || shaped.total < 2) return false;
    const cost = RailSystem.price(shaped.total);
    const extra = Math.max(0, cost - route.paid);
    if (extra > 0 && !charge(extra)) return false;
    const worlds = route.capsules.map((capsule) => capsule.active ? this.pointAt(route, capsule.distance) : null);
    const saved = route.capsules.map((capsule) => ({ active: capsule.active, cargo: capsule.cargo, wait: capsule.wait, travel: capsule.travel }));
    route.path = controls.map((point) => ({ x: point.x, z: point.z }));
    route.routed = true; route.paid = Math.max(route.paid, cost);
    route.travel = shaped.points; route.lengths = shaped.lengths; route.total = shaped.total;
    this.paint(route);
    route.capsules.forEach((capsule, index) => {
      const prev = saved[index]; if (!prev) return;
      capsule.active = prev.active; capsule.cargo = prev.cargo; capsule.wait = prev.wait; capsule.travel = prev.travel;
      if (prev.active && worlds[index]) capsule.distance = Math.min(this.project(route, worlds[index]!.x, worlds[index]!.z), Math.max(0, route.total - 0.02));
      this.positionCapsule(route, capsule);
    });
    return true;
  }

  private fadeAt(route: RailEntity, distance: number): number {
    const edge = Math.min(4.2, Math.max(0.8, route.total * 0.34));
    const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
    if (edge <= 0.01) return 0;
    return Math.min(smooth(distance / edge), smooth((route.total - distance) / edge));
  }
  private deckY(route: RailEntity, x: number, z: number, distance: number): number {
    return groundHeight(x, z) + 0.88 + (route.lane % 5) * 0.13 * this.fadeAt(route, distance);
  }
  private paint(route: RailEntity): void {
    for (const child of [...route.group.children]) { route.group.remove(child); disposeObject(child, true); }
    const path = route.travel;
    route.railY = this.deckY(route, path[0]?.x ?? 0, path[0]?.z ?? 0, 0);
    const pieces: Array<{ ax: number; az: number; bx: number; bz: number; ay: number; by: number; dist: number }> = [];
    let travelled = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i]; const len = Math.hypot(b.x - a.x, b.z - a.z); if (len < 0.05) continue;
      const steps = Math.max(1, Math.ceil(len / 4));
      for (let step = 0; step < steps; step++) {
        const t0 = step / steps, t1 = (step + 1) / steps;
        const ax = a.x + (b.x - a.x) * t0, az = a.z + (b.z - a.z) * t0;
        const bx = a.x + (b.x - a.x) * t1, bz = a.z + (b.z - a.z) * t1;
        const d0 = travelled + len * t0;
        pieces.push({ ax, az, bx, bz, ay: this.deckY(route, ax, az, d0), by: this.deckY(route, bx, bz, travelled + len * t1), dist: d0 });
      }
      travelled += len;
    }
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x263e49, metalness: 0.72, roughness: 0.34 });
    const glowMat = new THREE.MeshStandardMaterial({ color: LANE_COLORS[route.lane % 5], emissive: LANE_COLORS[route.lane % 5], emissiveIntensity: 0.55, metalness: 0.5, roughness: 0.24 });
    const nodes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.34, 0.42, 0.1, 8), baseMat, Math.max(1, pieces.length + 2));
    nodes.name = "maglev-emitter-nodes";
    const supports = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.14, 0.8, 8), baseMat, Math.max(1, pieces.length));
    const dummy = new THREE.Object3D(); let nodeIndex = 0, supportIndex = 0, marked = false;
    for (const piece of pieces) {
      const dx = piece.bx - piece.ax, dz = piece.bz - piece.az, len = Math.hypot(dx, dz); if (len < 0.02) continue;
      const yaw = Math.atan2(dx, dz), y = (piece.ay + piece.by) / 2;
      const guide = mesh(new THREE.BoxGeometry(0.5, 0.1, len), baseMat, route.group, (piece.ax + piece.bx) / 2, y - 0.05, (piece.az + piece.bz) / 2); guide.rotation.y = yaw; guide.castShadow = false; guide.userData.modernRail = true;
      const conductor = mesh(new THREE.BoxGeometry(0.12, 0.045, len), glowMat, route.group, (piece.ax + piece.bx) / 2, y + 0.02, (piece.az + piece.bz) / 2); conductor.rotation.y = yaw; conductor.castShadow = false; conductor.userData.modernRail = true;
      for (const side of [-0.18, 0.18]) {
        const strip = mesh(new THREE.BoxGeometry(0.035, 0.05, len), glowMat, route.group, (piece.ax + piece.bx) / 2 + Math.cos(yaw) * side, y + 0.01, (piece.az + piece.bz) / 2 - Math.sin(yaw) * side); strip.rotation.y = yaw; strip.castShadow = false;
      }
      dummy.position.set(piece.ax, piece.ay - 0.08, piece.az); dummy.rotation.set(0, yaw, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      if (nodeIndex < nodes.count) nodes.setMatrixAt(nodeIndex++, dummy.matrix);
      if (supportIndex < supports.count) {
        const gy = groundHeight(piece.ax, piece.az); const height = Math.max(0.2, piece.ay - 0.16 - gy);
        dummy.position.set(piece.ax, gy + height / 2, piece.az); dummy.scale.set(1, height / 0.8, 1); dummy.updateMatrix(); supports.setMatrixAt(supportIndex++, dummy.matrix);
      }
      if (!marked || len > 2.4) {
        const arrow = mesh(new THREE.ConeGeometry(0.13, 0.36, 3), glowMat, route.group, piece.ax + dx * 0.65, y + 0.14, piece.az + dz * 0.65);
        arrow.rotation.set(Math.PI / 2, yaw, 0); arrow.castShadow = false; arrow.userData.oneWay = true; marked = true;
      }
    }
    const ends = [path[0], path[path.length - 1]].filter((point): point is RailPathPoint => !!point);
    ends.forEach((point, index) => {
      const y = index === 0 ? route.railY : this.deckY(route, point.x, point.z, route.total);
      const pad = mesh(new THREE.CylinderGeometry(index === 0 ? 0.42 : 0.56, index === 0 ? 0.48 : 0.64, 0.1, 14), index === 0 ? baseMat : glowMat, route.group, point.x, y - 0.02, point.z);
      pad.userData.endpoint = index === 0 ? "source" : "dest"; pad.castShadow = false;
    });
    for (let i = 1; i < route.path.length - 1; i++) {
      const control = route.path[i]; let best = path[0], bestD = Infinity, bestIndex = 0;
      path.forEach((point, index) => { const dist = Math.hypot(point.x - control.x, point.z - control.z); if (dist < bestD) { best = point; bestD = dist; bestIndex = index; } });
      const along = route.lengths[bestIndex] ?? 0; const y = this.deckY(route, best.x, best.z, along);
      const hub = mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.08, 12), baseMat, route.group, best.x, y - 0.02, best.z); hub.userData.corner = true;
      const ring = mesh(new THREE.TorusGeometry(0.34, 0.035, 6, 18), glowMat, route.group, best.x, y + 0.05, best.z); ring.rotation.x = Math.PI / 2; ring.userData.corner = true;
    }
    nodes.count = Math.max(0, nodeIndex); supports.count = Math.max(0, supportIndex); route.group.add(nodes, supports);
    route.capsules = [];
    for (let slot = 0; slot < 4; slot++) route.capsules.push(this.makeCapsule(route.group, route.kind));
  }

  private makeCapsule(parent: THREE.Group, kind: CargoKind): CapsuleEntity {
    const group = new THREE.Group(); parent.add(group); group.visible = false;
    const shell = new THREE.MeshStandardMaterial({ color: kind === "raw" ? COLORS.orange : 0xdce9e5, metalness: 0.52, roughness: 0.32 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x8ff5ef, emissive: 0x2b9fa5, emissiveIntensity: 1.5, roughness: 0.2 });
    const body = mesh(new THREE.CapsuleGeometry(0.43, 1.05, 5, 12), shell, group, 0, 0.62); body.rotation.x = Math.PI / 2;
    for (const z of [-0.48, 0.48]) { const ring = mesh(new THREE.TorusGeometry(0.45, 0.055, 8, 20), glow, group, 0, 0.62, z); ring.castShadow = false; }
    const cargoVisual = new THREE.Group(); group.add(cargoVisual);
    const cargoMaterial = new THREE.MeshStandardMaterial({ color: kind === "ice" ? 0x8ddce9 : kind === "raw" ? 0xd5e5e3 : 0xf2ffff, roughness: kind === "ice" ? 0.2 : 0.68, metalness: 0.08 });
    const count = kind === "raw" ? 5 : 4;
    for (let i = 0; i < count; i++) {
      const geometry = kind === "raw" ? new THREE.IcosahedronGeometry(0.19, 1) : new THREE.BoxGeometry(0.31, 0.3, 0.36);
      mesh(geometry, cargoMaterial, cargoVisual, (i % 2 - 0.5) * 0.36, 1.05 + Math.floor(i / 4) * 0.24, (Math.floor(i / 2) - 0.75) * 0.32);
    }
    mesh(new THREE.BoxGeometry(0.36, 0.12, 0.05), glow, group, 0, 0.65, 0.98).castShadow = false;
    return { group, cargoVisual, active: false, cargo: 0, distance: 0, wait: 0, travel: 0, capacity: kind === "ice" ? 5 : kind === "raw" ? 30 : 28 };
  }
  private haul(kind: CargoKind, level: number): { capacity: number; speed: number; gap: number } {
    const step = Math.max(0, Math.min(2, level - 1));
    const pace = 1 + step * 0.42;
    return {
      capacity: (kind === "ice" ? 5 : kind === "raw" ? 30 : 28) + step * (kind === "ice" ? 2 : 8),
      speed: (kind === "ice" ? 15 : kind === "purified" ? 14 : 13) * pace,
      gap: 0.75 / pace,
    };
  }

  private pointAt(route: RailEntity, distance: number): RailPathPoint {
    const d = THREE.MathUtils.clamp(distance, 0, Math.max(0, route.total));
    let segment = 1;
    while (segment < route.lengths.length - 1 && route.lengths[segment] < d) segment++;
    const a = route.travel[Math.max(0, segment - 1)], b = route.travel[Math.min(route.travel.length - 1, segment)];
    if (!a || !b) return { x: 0, z: 0 };
    const start = route.lengths[Math.max(0, segment - 1)] ?? 0;
    const len = Math.max(0.001, (route.lengths[segment] ?? route.total) - start);
    const t = (d - start) / len;
    return { x: THREE.MathUtils.lerp(a.x, b.x, t), z: THREE.MathUtils.lerp(a.z, b.z, t) };
  }
  private project(route: RailEntity, x: number, z: number): number {
    let best = 0, bestD = Infinity;
    for (let i = 1; i < route.travel.length; i++) {
      const a = route.travel[i - 1], b = route.travel[i];
      const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
      const t = len2 < 1e-6 ? 0 : THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
      const px = a.x + dx * t, pz = a.z + dz * t, dist = Math.hypot(x - px, z - pz);
      if (dist < bestD) { bestD = dist; best = (route.lengths[i - 1] ?? 0) + Math.hypot(px - a.x, pz - a.z); }
    }
    return best;
  }
  private positionCapsule(route: RailEntity, capsule: CapsuleEntity): void {
    if (!capsule.active) { capsule.group.visible = false; return; }
    const point = this.pointAt(route, capsule.distance);
    const ahead = this.pointAt(route, Math.min(route.total, capsule.distance + 0.4));
    this.tmp.set(point.x, this.deckY(route, point.x, point.z, capsule.distance) + 0.08 + Math.sin(capsule.travel * 4) * 0.035, point.z); capsule.group.position.copy(this.tmp);
    capsule.group.rotation.y = Math.atan2(ahead.x - point.x, ahead.z - point.z); capsule.group.visible = capsule.distance > 0.85 && capsule.distance < route.total - 0.65;
    capsule.cargoVisual.visible = capsule.cargo > 0;
  }

  update(dt: number): void {
    for (const route of this.items) {
      const source = this.buildings.byId(route.sourceId); if (!source) continue;
      const haul = this.haul(route.kind, source.level);
      route.dispatch -= dt;
      const shared = this.network.claimsSource(route.sourceId);
      if (!shared && !source.damaged && source.powered && route.dispatch <= 0 && route.capsules.some((capsule) => !capsule.active)) {
        const capsule = route.capsules.find((candidate) => !candidate.active)!;
        capsule.capacity = haul.capacity;
        const cargo = this.buildings.drainOutput(source, capsule.capacity);
        if (cargo > 0.01) { capsule.active = true; capsule.cargo = cargo; capsule.distance = 0; capsule.wait = 0.35; capsule.travel = 0; route.dispatch = haul.gap; }
        else route.dispatch = 0.45;
      }
      for (const capsule of route.capsules) {
        if (!capsule.active) continue;
        if (capsule.wait > 0) capsule.wait -= dt;
        if (capsule.distance >= route.total && capsule.wait <= 0) {
          if (capsule.cargo > 0) {
            if (route.destinationId === 0) {
              const amount = capsule.cargo; this.sell(route.kind, amount, true); this.delivered(route.kind, amount); capsule.cargo = 0;
            } else {
              const destination = this.buildings.byId(route.destinationId);
              if (destination) { const accepted = this.buildings.acceptInput(destination, route.kind, capsule.cargo); if (accepted > 0) this.delivered(route.kind, accepted); capsule.cargo -= accepted; }
            }
          }
          if (capsule.cargo <= 0.001) { capsule.active = false; capsule.cargo = 0; capsule.group.visible = false; continue; }
          capsule.wait = 0.55;
        }
        if (capsule.wait <= 0 && capsule.distance < route.total) {
          const step = haul.speed * dt;
          capsule.distance = Math.min(route.total, capsule.distance + step); capsule.travel += step;
        }
        this.positionCapsule(route, capsule);
      }
    }
    this.network.update(dt);
  }

  hasSource(id: number): boolean { return this.items.some((route) => route.sourceId === id) || this.network.claimsSource(id); }
  private recoverCargo(route: RailEntity, abandonId: number): void {
    let cargo = 0;
    for (const capsule of route.capsules) if (capsule.active && capsule.cargo > 0) cargo += capsule.cargo;
    const source = abandonId === route.sourceId ? undefined : this.buildings.byId(route.sourceId);
    if (source && this.buildings.cargoKind(source) === route.kind && cargo > 0) {
      const room = Math.max(0, this.buildings.outputCapacity(source) - source.output);
      const stored = Math.min(cargo, room); source.output += stored; cargo -= stored;
    }
    const destination = route.destinationId !== 0 && abandonId !== route.destinationId ? this.buildings.byId(route.destinationId) : undefined;
    if (destination && cargo > 0) cargo -= this.buildings.acceptInput(destination, route.kind, cargo);
    if (cargo > 1e-4) this.buildings.retainCargo(route.kind, cargo);
    for (const capsule of route.capsules) capsule.cargo = 0;
  }
  removeBuilding(id: number, abandon = false): void { for (let i = this.items.length - 1; i >= 0; i--) if (this.items[i].sourceId === id || this.items[i].destinationId === id) { this.recoverCargo(this.items[i], abandon ? id : 0); this.group.remove(this.items[i].group); disposeObject(this.items[i].group, true); this.items.splice(i, 1); } this.network.detach(id); }
  serialize(): RailSave[] {
    return this.items.map((route) => ({
      sourceId: route.sourceId, destinationId: route.destinationId, path: route.path.map((point) => ({ ...point })),
      lane: route.lane, paid: route.paid, routed: route.routed,
      capsules: route.capsules.filter((capsule) => capsule.active).map((capsule) => ({ active: true, cargo: capsule.cargo, distance: capsule.distance, wait: capsule.wait, travel: capsule.travel })),
    }));
  }
  restore(items: RailSave[]): void {
    this.reset();
    for (const data of items) {
      const route = this.create(data.sourceId, data.destinationId, data.path, () => true, true, { lane: data.lane ?? 0, routed: data.routed === true, paid: data.paid }); if (!route) continue;
      for (const [index, saved] of (data.capsules ?? []).filter((capsule) => capsule.active).entries()) {
        const capsule = route.capsules[index]; if (!capsule) break;
        capsule.active = true; capsule.cargo = Math.max(0, saved.cargo); capsule.distance = THREE.MathUtils.clamp(saved.distance, 0, route.total);
        capsule.wait = Math.max(0, saved.wait); capsule.travel = Math.max(0, saved.travel); this.positionCapsule(route, capsule);
      }
    }
  }
  reset(): void { for (const route of this.items) { this.group.remove(route.group); disposeObject(route.group, true); } this.items.length = 0; this.network.reset(); }
  dispose(): void { this.reset(); this.scene.remove(this.group); }
}
