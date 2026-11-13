import * as THREE from "three";
import { COLORS } from "./config";
import { groundHeight, type CircleZone } from "./snow";
import { mesh } from "./world";

export type RelayId = "gale" | "servo" | "foundry";
export interface RelayEntity {
  id: RelayId; x: number; z: number; cost: number; warmth: number; repaired: boolean;
  group: THREE.Group; moving: THREE.Group; ring: THREE.Mesh; core: THREE.MeshStandardMaterial; wreck: THREE.Group;
}
export interface RelayView { id: RelayId; x: number; z: number; cost: number; warmth: number; repaired: boolean; distance: number }

const DATA: Array<Omit<RelayEntity, "group" | "moving" | "ring" | "core" | "wreck" | "repaired">> = [
  { id: "gale", x: -33.75, z: -36.45, cost: 650, warmth: 13 },
  { id: "servo", x: 43.2, z: 29.7, cost: 1050, warmth: 12 },
  { id: "foundry", x: -45.9, z: 10.8, cost: 1450, warmth: 14 },
];

/** Three optional recovery landmarks: local warm/clear zones plus one global bonus each. */
export class RelaySystem {
  readonly group = new THREE.Group(); readonly items: RelayEntity[] = [];
  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    for (const data of DATA) this.create(data);
  }
  private create(data: Omit<RelayEntity, "group" | "moving" | "ring" | "core" | "wreck" | "repaired">): void {
    const group = new THREE.Group(); group.position.set(data.x, groundHeight(data.x, data.z), data.z); this.group.add(group);
    const dark = new THREE.MeshStandardMaterial({ color: 0x263d47, metalness: 0.62, roughness: 0.45 });
    const shell = new THREE.MeshStandardMaterial({ color: 0xd4ded9, metalness: 0.22, roughness: 0.58 });
    const accentColor = data.id === "gale" ? 0x78dfe6 : data.id === "servo" ? 0xffb45d : 0xa8e39a;
    const core = new THREE.MeshStandardMaterial({ color: 0x9b5945, emissive: 0x6e271c, emissiveIntensity: 0.45, metalness: 0.3, roughness: 0.4 });
    mesh(new THREE.CylinderGeometry(2.1, 2.35, 0.4, 20), dark, group, 0, 0.2);
    mesh(new THREE.CylinderGeometry(0.72, 1.15, 2.25, 12), shell, group, 0, 1.35);
    const moving = new THREE.Group(); moving.position.y = 2.45; group.add(moving);
    if (data.id === "gale") {
      const mast = mesh(new THREE.CylinderGeometry(0.13, 0.2, 2.5, 10), dark, moving, 0, 0.85);
      for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; const vane = mesh(new THREE.BoxGeometry(0.22, 0.18, 2.4), shell, moving, Math.sin(a) * 0.9, 1.7, Math.cos(a) * 0.9); vane.rotation.y = a; }
      mesh(new THREE.SphereGeometry(0.52, 16, 10), core, moving, 0, 1.7);
      mast.rotation.z = 0.08;
    } else if (data.id === "servo") {
      for (const side of [-1, 1]) { const arm = mesh(new THREE.BoxGeometry(0.28, 2.3, 0.35), shell, moving, side * 0.85, 0.65); arm.rotation.z = side * -0.3; }
      const halo = mesh(new THREE.TorusGeometry(1.4, 0.13, 10, 36), core, moving, 0, 1.35); halo.rotation.x = Math.PI / 2;
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; mesh(new THREE.BoxGeometry(0.3, 0.45, 0.3), dark, moving, Math.sin(a) * 1.4, 1.35, Math.cos(a) * 1.4); }
    } else {
      mesh(new THREE.CylinderGeometry(1.05, 1.2, 1.4, 16), dark, moving, 0, 0.5);
      mesh(new THREE.CylinderGeometry(0.66, 0.66, 1.8, 16), core, moving, 0, 1.3);
      for (let i = 0; i < 3; i++) { const ring = mesh(new THREE.TorusGeometry(0.86 + i * 0.15, 0.08, 8, 28), shell, moving, 0, 1.3); ring.rotation.set(Math.PI / 2 + i * 0.55, i * 0.6, 0); }
    }
    const wreck = new THREE.Group(); group.add(wreck);
    for (let i = 0; i < 4; i++) { const panel = mesh(new THREE.BoxGeometry(0.75, 0.12, 0.5), i % 2 ? dark : shell, wreck, Math.sin(i * 2.2) * 1.4, 0.45 + i * 0.12, Math.cos(i * 1.7) * 1.25); panel.rotation.set(i * 0.3, i, i * 0.45); }
    const ring = mesh(new THREE.RingGeometry(0.988, 1, 96), new THREE.MeshBasicMaterial({ color: accentColor, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }), group, 0, 0.09);
    ring.rotation.x = -Math.PI / 2; ring.scale.setScalar(data.warmth); ring.castShadow = false;
    this.items.push({ ...data, repaired: false, group, moving, ring, core, wreck });
    this.refresh(this.items[this.items.length - 1]);
  }
  private refresh(r: RelayEntity): void {
    r.wreck.visible = !r.repaired; r.ring.visible = r.repaired;
    r.core.color.setHex(r.repaired ? (r.id === "gale" ? COLORS.cyan : r.id === "servo" ? COLORS.orange : 0xa8e39a) : 0x9b5945);
    r.core.emissive.copy(r.core.color); r.core.emissiveIntensity = r.repaired ? 1.5 : 0.35;
  }
  nearest(x: number, z: number, range = 4.2): RelayEntity | null {
    let best: RelayEntity | null = null; let dBest = range;
    for (const r of this.items) { const d = Math.hypot(x - r.x, z - r.z); if (d < dBest) { best = r; dBest = d; } }
    return best;
  }
  repair(id: RelayId): boolean { const r = this.items.find((item) => item.id === id); if (!r || r.repaired) return false; r.repaired = true; this.refresh(r); return true; }
  repaired(id: RelayId): boolean { return !!this.items.find((r) => r.id === id)?.repaired; }
  zones(): CircleZone[] { return this.items.filter((r) => r.repaired).map((r) => ({ x: r.x, z: r.z, r: r.warmth })); }
  views(x: number, z: number): RelayView[] { return this.items.map((r) => ({ id: r.id, x: r.x, z: r.z, cost: r.cost, warmth: r.warmth, repaired: r.repaired, distance: Math.hypot(x - r.x, z - r.z) })); }
  update(dt: number, time: number): void { for (const r of this.items) if (r.repaired) { r.moving.rotation.y += dt * (r.id === "servo" ? 1.3 : 0.55); r.moving.position.y = 2.45 + Math.sin(time * 1.8 + r.x) * 0.06; } }
  reset(): void { for (const r of this.items) { r.repaired = false; this.refresh(r); } }
  serialize(): RelayId[] { return this.items.filter((r) => r.repaired).map((r) => r.id); }
  restore(ids: RelayId[]): void { this.reset(); for (const id of ids) this.repair(id); }
}
