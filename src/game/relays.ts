import * as THREE from "three";
import { COLORS } from "./config";
import { groundHeight, type CircleZone } from "./snow";
import { mesh } from "./world";

export type RelayId = "gale" | "servo" | "foundry";
export interface RelayEntity {
  id: RelayId; x: number; z: number; cost: number; warmth: number; repaired: boolean; live: boolean;
  group: THREE.Group; moving: THREE.Group; ring: THREE.Mesh; core: THREE.MeshStandardMaterial; wreck: THREE.Group;
}
export interface RelayView { id: RelayId; x: number; z: number; cost: number; warmth: number; repaired: boolean; distance: number }

const relayDark = new THREE.MeshStandardMaterial({ color: 0x263d47, metalness: 0.55, roughness: 0.48 });
const relayShell = new THREE.MeshStandardMaterial({ color: 0xd8e1dc, metalness: 0.2, roughness: 0.55 });
const relayOrange = new THREE.MeshStandardMaterial({ color: COLORS.orange, metalness: 0.28, roughness: 0.46 });
const DATA: Array<Omit<RelayEntity, "group" | "moving" | "ring" | "core" | "wreck" | "repaired" | "live">> = [
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
  private create(data: Omit<RelayEntity, "group" | "moving" | "ring" | "core" | "wreck" | "repaired" | "live">): void {
    const group = new THREE.Group(); group.position.set(data.x, groundHeight(data.x, data.z), data.z); this.group.add(group);
    const accentColor = data.id === "gale" ? COLORS.cyan : data.id === "servo" ? COLORS.orange : COLORS.warm;
    const core = new THREE.MeshStandardMaterial({ color: 0x9b5945, emissive: 0x6e271c, emissiveIntensity: 0.45, metalness: 0.3, roughness: 0.4 });
    mesh(new THREE.CylinderGeometry(1.75, 1.95, 0.32, 20), relayDark, group, 0, 0.18);
    const pod = mesh(new THREE.SphereGeometry(1.15, 18, 12), relayShell, group, 0, 1.35, 0); pod.scale.set(1, 0.78, 1);
    const collar = mesh(new THREE.TorusGeometry(0.78, 0.09, 8, 18), relayOrange, group, 0, 2.05, 0); collar.rotation.x = Math.PI / 2;
    const moving = new THREE.Group(); moving.position.y = 2.45; group.add(moving);
    if (data.id === "gale") {
      mesh(new THREE.CapsuleGeometry(0.08, 0.28, 3, 6), relayDark, moving, 0, -0.05);
      for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; const vane = mesh(new THREE.BoxGeometry(0.14, 0.08, 1.35), relayShell, moving, Math.sin(a) * 0.62, 0.18, Math.cos(a) * 0.62); vane.rotation.y = a; }
      mesh(new THREE.SphereGeometry(0.36, 16, 10), core, moving, 0, 0.18);
    } else if (data.id === "servo") {
      for (const side of [-1, 1] as const) { const arm = mesh(new THREE.CapsuleGeometry(0.1, 0.55, 3, 6), relayShell, moving, side * 0.72, -0.05); arm.rotation.z = side * -0.15; }
      const halo = mesh(new THREE.TorusGeometry(1.05, 0.1, 10, 28), core, moving, 0, 0.22); halo.rotation.x = Math.PI / 2;
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; mesh(new THREE.SphereGeometry(0.14, 8, 6), relayDark, moving, Math.sin(a) * 1.05, 0.22, Math.cos(a) * 1.05); }
    } else {
      const kiln = mesh(new THREE.SphereGeometry(0.72, 16, 12), relayDark, moving, 0, 0.12); kiln.scale.set(1, 0.7, 1);
      mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.55, 14), core, moving, 0, 0.28);
      for (let i = 0; i < 2; i++) { const ring = mesh(new THREE.TorusGeometry(0.5 + i * 0.12, 0.06, 8, 20), relayShell, moving, 0, 0.08 + i * 0.22); ring.rotation.x = Math.PI / 2; }
    }
    const wreck = new THREE.Group(); group.add(wreck);
    for (let i = 0; i < 4; i++) { const panel = mesh(new THREE.BoxGeometry(0.7, 0.12, 0.46), i % 2 ? relayDark : relayShell, wreck, Math.sin(i * 2.2) * 1.35, 0.42 + i * 0.12, Math.cos(i * 1.7) * 1.2); panel.rotation.set(i * 0.3, i, i * 0.45); }
    const ring = mesh(new THREE.RingGeometry(0.988, 1, 96), new THREE.MeshBasicMaterial({ color: accentColor, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }), group, 0, 0.09);
    ring.rotation.x = -Math.PI / 2; ring.scale.setScalar(data.warmth); ring.castShadow = false;
    this.items.push({ ...data, repaired: false, live: false, group, moving, ring, core, wreck });
    this.refresh(this.items[this.items.length - 1]);
  }
  private refresh(r: RelayEntity): void {
    const tint = r.id === "gale" ? COLORS.cyan : r.id === "servo" ? COLORS.orange : COLORS.warm;
    r.wreck.visible = !r.repaired; r.ring.visible = r.repaired;
    r.core.color.setHex(r.repaired && r.live ? tint : 0x9b5945);
    r.core.emissive.copy(r.core.color); r.core.emissiveIntensity = r.repaired && r.live ? 1.5 : r.repaired ? 0.2 : 0.35;
  }
  setLive(id: RelayId, live: boolean): void {
    const relay = this.items.find((item) => item.id === id); if (!relay || relay.live === live) return;
    relay.live = live; this.refresh(relay);
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
  reset(): void { for (const r of this.items) { r.repaired = false; r.live = false; this.refresh(r); } }
  serialize(): RelayId[] { return this.items.filter((r) => r.repaired).map((r) => r.id); }
  restore(ids: RelayId[]): void { this.reset(); for (const id of ids) this.repair(id); }
}
