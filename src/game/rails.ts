import * as THREE from "three";
import type { CargoKind } from "./types";
import { disposeObject } from "./resources";
import { COLORS, GAME } from "./config";
import { BuildingSystem } from "./buildings";
import { mesh } from "./world";
import { groundHeight } from "./snow";

export interface RailPathPoint { x: number; z: number }
interface CapsuleEntity {
  group: THREE.Group; cargoVisual: THREE.Group; active: boolean; cargo: number;
  distance: number; wait: number; travel: number; capacity: number;
}
export interface RailEntity {
  sourceId: number; destinationId: number; path: RailPathPoint[]; lengths: number[]; total: number;
  group: THREE.Group; capsules: CapsuleEntity[]; kind: CargoKind; dispatch: number; railY: number;
}

/** Elevated magnetic guideway with autonomous one-way freight capsules. */
export class RailSystem {
  readonly group = new THREE.Group(); readonly items: RailEntity[] = [];
  private tmp = new THREE.Vector3();
  constructor(
    private scene: THREE.Scene,
    private buildings: BuildingSystem,
    private sell: (kind: CargoKind, amount: number, byRail: boolean) => void,
    private delivered: (kind: CargoKind, amount: number) => void,
  ) { scene.add(this.group); }

  static pathFor(x: number, z: number, destinationX: number = GAME.depot.x, destinationZ: number = GAME.depot.z - 3.2): RailPathPoint[] {
    const path = [{ x, z }];
    if (Math.abs(x - destinationX) > 3 && Math.abs(z - destinationZ) > 3) path.push({ x, z: destinationZ });
    path.push({ x: destinationX, z: destinationZ }); return path;
  }
  static pathLength(path: RailPathPoint[]): number {
    let total = 0; for (let i = 1; i < path.length; i++) total += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z); return total;
  }
  private compatible(kind: CargoKind, destinationId: number): boolean {
    if (destinationId === 0) return kind === "purified" || kind === "ice";
    const destination = this.buildings.byId(destinationId);
    return !!destination && ((kind === "raw" && destination.type === "purifier") || (kind === "purified" && destination.type === "press"));
  }

  create(sourceId: number, destinationId: number, path: RailPathPoint[], charge: (cost: number) => boolean, restored = false): RailEntity | null {
    const source = this.buildings.byId(sourceId); const kind = source ? this.buildings.cargoKind(source) : null;
    if (!source || !kind || !this.compatible(kind, destinationId) || sourceId === destinationId || this.items.some((r) => r.sourceId === sourceId && r.destinationId === destinationId)) return null;
    if (path.length < 2 || RailSystem.pathLength(path) < 2) return null;
    const cost = Math.max(24, Math.ceil(RailSystem.pathLength(path) * 2.2)); if (!restored && !charge(cost)) return null;
    const group = new THREE.Group(); group.name = `maglev-${sourceId}-${destinationId}`; this.group.add(group);
    const railY = Math.max(...path.map((p) => groundHeight(p.x, p.z))) + 0.92;
    const lengths = [0]; let total = 0; let nodeCount = 0;
    for (let i = 1; i < path.length; i++) { const length = Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z); total += length; lengths.push(total); nodeCount += Math.floor(length / 2.2) + 1; }
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x263e49, metalness: 0.72, roughness: 0.34 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x7ae5e2, emissive: 0x238e96, emissiveIntensity: 1.15, metalness: 0.5, roughness: 0.24 });
    const nodes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.55, 0.13, 8), baseMat, Math.max(1, nodeCount));
    nodes.name = "maglev-emitter-nodes";
    const supports = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.18, 0.8, 8), baseMat, Math.max(1, Math.ceil(nodeCount / 3)));
    const dummy = new THREE.Object3D(); let nodeIndex = 0, supportIndex = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i]; const dx = b.x - a.x, dz = b.z - a.z; const len = Math.hypot(dx, dz); const yaw = Math.atan2(dx, dz);
      const guide = mesh(new THREE.BoxGeometry(0.76, 0.12, len), baseMat, group, (a.x + b.x) / 2, railY - 0.08, (a.z + b.z) / 2); guide.rotation.y = yaw; guide.castShadow = false; guide.userData.modernRail = true;
      const conductor = mesh(new THREE.BoxGeometry(0.19, 0.055, len), glowMat, group, (a.x + b.x) / 2, railY + 0.005, (a.z + b.z) / 2); conductor.rotation.y = yaw; conductor.castShadow = false; conductor.userData.modernRail = true;
      for (const side of [-0.43, 0.43]) {
        const strip = mesh(new THREE.BoxGeometry(0.055, 0.07, len), glowMat, group, (a.x + b.x) / 2 + Math.cos(yaw) * side, railY, (a.z + b.z) / 2 - Math.sin(yaw) * side); strip.rotation.y = yaw; strip.castShadow = false;
      }
      const count = Math.floor(len / 2.2) + 1;
      for (let n = 0; n < count; n++) {
        const d = Math.min(len, n * 2.2); const px = a.x + dx / len * d, pz = a.z + dz / len * d;
        dummy.position.set(px, railY - 0.13, pz); dummy.rotation.set(0, yaw, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); nodes.setMatrixAt(nodeIndex++, dummy.matrix);
        if (n % 3 === 0) { const gy = groundHeight(px, pz); const height = Math.max(0.25, railY - 0.2 - gy); dummy.position.set(px, gy + height / 2, pz); dummy.scale.set(1, height / 0.8, 1); dummy.updateMatrix(); supports.setMatrixAt(supportIndex++, dummy.matrix); }
      }
      for (let d = 3; d < len - 1; d += 5.5) {
        const arrow = mesh(new THREE.ConeGeometry(0.17, 0.48, 3), glowMat, group, a.x + dx / len * d, railY + 0.16, a.z + dz / len * d);
        arrow.rotation.set(Math.PI / 2, yaw, 0); arrow.castShadow = false; arrow.userData.oneWay = true;
      }
    }
    for (let i = 1; i < path.length - 1; i++) {
      const corner = path[i]; const hub = mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.16, 16), baseMat, group, corner.x, railY - 0.08, corner.z); hub.userData.corner = true;
      const ring = mesh(new THREE.TorusGeometry(0.56, 0.055, 7, 24), glowMat, group, corner.x, railY + 0.03, corner.z); ring.rotation.x = Math.PI / 2; ring.userData.corner = true;
    }
    nodes.count = nodeIndex; supports.count = supportIndex; group.add(nodes, supports);
    const capsules: CapsuleEntity[] = [];
    for (let slot = 0; slot < 4; slot++) capsules.push(this.makeCapsule(group, kind));
    const entity: RailEntity = { sourceId, destinationId, path: path.map((p) => ({ ...p })), lengths, total, group, capsules, kind, dispatch: 0.25, railY };
    this.items.push(entity); return entity;
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

  private positionCapsule(r: RailEntity, c: CapsuleEntity): void {
    if (!c.active) { c.group.visible = false; return; }
    const d = THREE.MathUtils.clamp(c.distance, 0, r.total); let segment = 1;
    while (segment < r.lengths.length - 1 && r.lengths[segment] < d) segment++;
    const a = r.path[segment - 1], b = r.path[segment]; const start = r.lengths[segment - 1]; const len = Math.max(0.001, r.lengths[segment] - start); const t = (d - start) / len;
    this.tmp.set(THREE.MathUtils.lerp(a.x, b.x, t), r.railY + 0.08 + Math.sin(c.travel * 4) * 0.035, THREE.MathUtils.lerp(a.z, b.z, t)); c.group.position.copy(this.tmp);
    c.group.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); c.group.visible = d > 0.85 && d < r.total - 0.65;
    c.cargoVisual.visible = c.cargo > 0;
  }

  update(dt: number): void {
    for (const r of this.items) {
      const source = this.buildings.byId(r.sourceId); if (!source) continue;
      r.dispatch -= dt;
      if (!source.damaged && source.powered && r.dispatch <= 0 && r.capsules.filter((c) => c.active).length < r.capsules.length) {
        const capsule = r.capsules.find((c) => !c.active)!;
        const cargo = this.buildings.drainOutput(source, capsule.capacity);
        if (cargo > 0.01) { capsule.active = true; capsule.cargo = cargo; capsule.distance = 0; capsule.wait = 0.35; capsule.travel = 0; r.dispatch = 0.75; }
        else r.dispatch = 0.45;
      }
      for (const capsule of r.capsules) {
        if (!capsule.active) continue;
        if (capsule.wait > 0) capsule.wait -= dt;
        if (capsule.distance >= r.total && capsule.wait <= 0) {
          if (capsule.cargo > 0) {
            if (r.destinationId === 0) {
              const amount = capsule.cargo; this.sell(r.kind, amount, true); this.delivered(r.kind, amount); capsule.cargo = 0;
            } else {
              const destination = this.buildings.byId(r.destinationId);
              if (destination) { const accepted = this.buildings.acceptInput(destination, r.kind, capsule.cargo); if (accepted > 0) this.delivered(r.kind, accepted); capsule.cargo -= accepted; }
            }
          }
          if (capsule.cargo <= 0.001) { capsule.active = false; capsule.cargo = 0; capsule.group.visible = false; continue; }
          capsule.wait = 0.55;
        }
        if (capsule.wait <= 0 && capsule.distance < r.total) {
          const step = (r.kind === "ice" ? 15 : r.kind === "purified" ? 14 : 13) * dt;
          capsule.distance = Math.min(r.total, capsule.distance + step); capsule.travel += step;
        }
        this.positionCapsule(r, capsule);
      }
    }
  }

  hasSource(id: number): boolean { return this.items.some((r) => r.sourceId === id); }
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
  removeBuilding(id: number, abandon = false): void { for (let i = this.items.length - 1; i >= 0; i--) if (this.items[i].sourceId === id || this.items[i].destinationId === id) { this.recoverCargo(this.items[i], abandon ? id : 0); this.group.remove(this.items[i].group); disposeObject(this.items[i].group, true); this.items.splice(i, 1); } }
  serialize(): Array<{ sourceId: number; destinationId: number; path: RailPathPoint[]; capsules?: Array<{ active: boolean; cargo: number; distance: number; wait: number; travel: number }> }> {
    return this.items.map((r) => ({ sourceId: r.sourceId, destinationId: r.destinationId, path: r.path.map((p) => ({ ...p })), capsules: r.capsules.filter((c) => c.active).map((c) => ({ active: true, cargo: c.cargo, distance: c.distance, wait: c.wait, travel: c.travel })) }));
  }
  restore(items: Array<{ sourceId: number; destinationId: number; path: RailPathPoint[]; capsules?: Array<{ active: boolean; cargo: number; distance: number; wait: number; travel: number }> }>): void {
    this.reset();
    for (const data of items) {
      const route = this.create(data.sourceId, data.destinationId, data.path, () => true, true); if (!route) continue;
      for (const [index, saved] of (data.capsules ?? []).filter((c) => c.active).entries()) {
        const capsule = route.capsules[index]; if (!capsule) break;
        capsule.active = true; capsule.cargo = Math.max(0, saved.cargo); capsule.distance = THREE.MathUtils.clamp(saved.distance, 0, route.total);
        capsule.wait = Math.max(0, saved.wait); capsule.travel = Math.max(0, saved.travel); this.positionCapsule(route, capsule);
      }
    }
  }
  reset(): void { for (const r of this.items) { this.group.remove(r.group); disposeObject(r.group, true); } this.items.length = 0; }
  dispose(): void { this.reset(); this.scene.remove(this.group); }
}
