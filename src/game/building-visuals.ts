import * as THREE from "three";
import type { BuildingType } from "./types";
import { COLORS } from "./config";
import { mesh } from "./world";
import type { BuildingEntity } from "./buildings";

export const generatorRadius = (level: number): number => 9 + Math.max(0, level - 1) * 4;

export const mats = {
cream: new THREE.MeshStandardMaterial({ color: 0xe3e4d8, roughness: 0.54, metalness: 0.18 }),
dark: new THREE.MeshStandardMaterial({ color: 0x284852, roughness: 0.5, metalness: 0.45 }),
orange: new THREE.MeshStandardMaterial({ color: COLORS.orange, roughness: 0.45, metalness: 0.25 }),
cyan: new THREE.MeshStandardMaterial({ color: 0x82dfe2, emissive: 0x1b7f86, emissiveIntensity: 0.8, roughness: 0.25 }),
rubber: new THREE.MeshStandardMaterial({ color: 0x1b3038, roughness: 0.88 }),
};

export function makeBuildingVisual(type: BuildingType, status: THREE.MeshStandardMaterial): { group: THREE.Group; ring: THREE.Mesh; fallback: THREE.Group; moving: THREE.Group } {
  const group = new THREE.Group(); const fallback = new THREE.Group(); const moving = new THREE.Group(); group.add(fallback, moving);
  const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  const ring = mesh(new THREE.RingGeometry(0.975, 1, type === "generator" ? 96 : 48), ringMat, group, 0, 0.07);
  ring.scale.setScalar(type === "heater" ? 7 : type === "generator" ? generatorRadius(1) : 2);
  ring.rotation.x = -Math.PI / 2; ring.castShadow = false;
  if (type === "purifier") {
    mesh(new THREE.BoxGeometry(2.4, 1.65, 1.9), mats.cream, fallback, 0, 0.95);
    const rotor = mesh(new THREE.CylinderGeometry(0.95, 0.55, 1.05, 12), mats.dark, moving, 0, 2.15);
    for (let i = 0; i < 4; i++) { const fin = mesh(new THREE.BoxGeometry(0.12, 0.12, 1.25), mats.orange, rotor, 0, 0.55, 0); fin.rotation.y = i * Math.PI / 2; }
    mesh(new THREE.CylinderGeometry(0.46, 0.46, 1.55, 14), mats.cyan, fallback, 1.35, 1.05);
    for (const z of [-0.55, 0.55]) { const pipe = mesh(new THREE.TorusGeometry(0.52, 0.09, 8, 16, Math.PI), mats.orange, fallback, -1.2, 1.15, z); pipe.rotation.y = Math.PI / 2; }
    mesh(new THREE.BoxGeometry(0.65, 0.42, 0.07), status, fallback, 0.65, 1.2, -0.99);
  } else if (type === "press") {
    mesh(new THREE.BoxGeometry(2.6, 0.55, 2.1), mats.dark, fallback, 0, 0.35);
    for (const x of [-1, 1]) mesh(new THREE.BoxGeometry(0.32, 2.2, 0.35), mats.orange, fallback, x, 1.45);
    mesh(new THREE.BoxGeometry(2.35, 0.45, 1.6), mats.cream, fallback, 0, 2.5);
    mesh(new THREE.CylinderGeometry(0.27, 0.27, 1.3, 12), mats.dark, moving, 0, 1.75);
    mesh(new THREE.BoxGeometry(1.45, 0.32, 1.15), mats.cyan, moving, 0, 0.85);
    mesh(new THREE.BoxGeometry(0.62, 0.4, 0.07), status, fallback, 0.7, 2.5, -0.83);
  } else if (type === "heater") {
    mesh(new THREE.CylinderGeometry(0.65, 0.85, 0.35, 12), mats.dark, fallback, 0, 0.2);
    mesh(new THREE.CylinderGeometry(0.15, 0.22, 2.4, 10), mats.cream, fallback, 0, 1.45);
    const coils: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) { const coil = mesh(new THREE.TorusGeometry(0.48, 0.08, 8, 20), status, moving, 0, 1.35 + i * 0.38); coil.rotation.x = Math.PI / 2; coils.push(coil); }
    const pulses: THREE.Mesh[] = [];
    for (let i = 0; i < 2; i++) { const pulse = mesh(new THREE.SphereGeometry(0.12, 10, 8), mats.cyan, moving, 0, 1.35 + i * 0.5); pulse.castShadow = false; pulses.push(pulse); }
    moving.userData.coils = coils; moving.userData.pulses = pulses;
    mesh(new THREE.ConeGeometry(0.65, 0.35, 12), mats.orange, fallback, 0, 2.85);
  } else if (type === "generator") {
    // Compact orbital turbine: three splayed feet, a glowing core and counter-rotating rings.
    mesh(new THREE.CylinderGeometry(0.85, 1.1, 0.42, 18), mats.dark, fallback, 0, 0.25);
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3; const leg = mesh(new THREE.BoxGeometry(0.28, 0.3, 1.35), mats.orange, fallback, Math.sin(a) * 0.75, 0.28, Math.cos(a) * 0.75);
      leg.rotation.y = a; leg.rotation.x = 0.12;
    }
    mesh(new THREE.CylinderGeometry(0.36, 0.52, 1.65, 14), mats.cream, fallback, 0, 1.15);
    const core = mesh(new THREE.SphereGeometry(0.55, 18, 12), status, moving, 0, 1.65); core.name = "generator-core";
    const orbitA = mesh(new THREE.TorusGeometry(1.05, 0.105, 9, 32), mats.cyan, moving, 0, 1.65); orbitA.rotation.x = Math.PI / 2.8;
    const orbitB = mesh(new THREE.TorusGeometry(0.84, 0.075, 8, 28), mats.orange, moving, 0, 1.65); orbitB.rotation.y = Math.PI / 2;
    for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; mesh(new THREE.BoxGeometry(0.2, 0.5, 0.12), mats.cream, fallback, Math.sin(a) * 0.66, 1.03, Math.cos(a) * 0.66).rotation.y = a; }
  } else {
    // A proper service dock: raised charging pad, canopy, tanks and a readable role-specific bay.
    mesh(new THREE.CylinderGeometry(1.55, 1.72, 0.3, 20), mats.dark, fallback, 0, 0.17);
    mesh(new THREE.CylinderGeometry(1.24, 1.35, 0.12, 20), mats.cream, fallback, 0, 0.38);
    const chargePad = mesh(new THREE.TorusGeometry(0.78, 0.055, 8, 28), status, fallback, 0, 0.47, -0.15); chargePad.rotation.x = Math.PI / 2;
    for (const x of [-1.05, 1.05]) {
      mesh(new THREE.BoxGeometry(0.18, 1.75, 0.22), mats.orange, fallback, x, 1.15, 0.55);
      mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.35, 10), mats.dark, fallback, x, 0.36, 0.55);
    }
    mesh(new THREE.BoxGeometry(2.35, 0.22, 1.55), type === "sweeper" ? mats.orange : mats.cream, fallback, 0, 2.08, 0.45);
    const roof = mesh(new THREE.SphereGeometry(1.18, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), type === "sweeper" ? mats.orange : mats.cream, fallback, 0, 2.16, 0.43);
    roof.scale.set(1, 0.34, 0.72);
    mesh(new THREE.BoxGeometry(1.45, 0.85, 0.52), mats.dark, fallback, 0, 1.22, 0.88);
    mesh(new THREE.BoxGeometry(0.72, 0.36, 0.06), status, fallback, 0, 1.38, 0.59);
    for (const x of [-0.52, 0.52]) mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.95, 12), type === "sweeper" ? mats.cream : mats.orange, fallback, x, 0.95, 1.12);
    if (type === "sweeper") {
      for (const x of [-0.52, 0.52]) { const brush = mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.45, 12), mats.cyan, moving, x, 0.56, -0.88); brush.rotation.z = Math.PI / 2; }
    } else {
      for (const x of [-0.42, 0.42]) mesh(new THREE.BoxGeometry(0.58, 0.48, 0.58), mats.cyan, moving, x, 0.7, -0.88);
    }
    mesh(new THREE.CylinderGeometry(0.045, 0.075, 1.2, 8), mats.dark, fallback, 0.88, 2.72, 0.55);
    mesh(new THREE.SphereGeometry(0.14, 8, 6), status, moving, 0.88, 3.35, 0.55);
  }
  return { group, ring, fallback, moving };
}


export function createLevelDetails(b: BuildingEntity): void {
  for (const level of [2, 3]) {
    const detail = new THREE.Group(); detail.name = `upgrade-level-${level}`; detail.userData.upgradeLevel = level;
    detail.visible = b.level >= level; b.group.add(detail); b.levelDetails.push(detail);
    if (b.type === "purifier") {
      if (level === 2) {
        mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.25, 12), mats.cyan, detail, -1.45, 0.85, 0.4);
        const pipe = mesh(new THREE.TorusGeometry(0.5, 0.075, 8, 18, Math.PI), mats.orange, detail, -1.25, 1.55, 0.4); pipe.rotation.y = Math.PI / 2;
        mesh(new THREE.BoxGeometry(0.55, 0.22, 0.7), mats.dark, detail, -1.45, 0.18, 0.4);
      } else {
        for (const x of [-0.72, 0.72]) mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.85, 10), mats.cream, detail, x, 2.7, 0.45);
        mesh(new THREE.BoxGeometry(1.75, 0.14, 0.4), mats.orange, detail, 0, 3.12, 0.45);
        mesh(new THREE.SphereGeometry(0.13, 8, 6), mats.cyan, detail, 0, 3.32, 0.45);
      }
    } else if (b.type === "press") {
      if (level === 2) {
        for (const x of [-1.32, 1.32]) {
          mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.35, 10), mats.dark, detail, x, 1.25, 0.4);
          mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.05, 8), mats.cyan, detail, x, 2.15, 0.4);
        }
      } else {
        mesh(new THREE.BoxGeometry(2.15, 0.13, 0.85), mats.orange, detail, 0, 0.65, 1.42);
        for (const x of [-0.7, 0, 0.7]) mesh(new THREE.BoxGeometry(0.5, 0.5, 0.55), mats.cyan, detail, x, 0.98, 1.42);
      }
    } else if (b.type === "heater") {
      if (level === 2) {
        const extraCoil = mesh(new THREE.TorusGeometry(0.72, 0.07, 8, 24), mats.orange, detail, 0, 2.15); extraCoil.rotation.x = Math.PI / 2;
        for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; const fin = mesh(new THREE.BoxGeometry(0.1, 0.5, 0.65), mats.cream, detail, Math.sin(a) * 0.58, 0.55, Math.cos(a) * 0.58); fin.rotation.y = a; }
      } else {
        for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.52, 10), mats.orange, detail, Math.sin(a) * 1.15, 0.3, Math.cos(a) * 1.15); mesh(new THREE.SphereGeometry(0.11, 8, 6), mats.cyan, detail, Math.sin(a) * 1.15, 0.64, Math.cos(a) * 1.15); }
      }
    } else if (b.type === "generator") {
      if (level === 2) {
        for (const x of [-0.7, 0.7]) { mesh(new THREE.CylinderGeometry(0.13, 0.18, 1.2, 10), mats.dark, detail, x, 2.55, 0.25); mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 10), mats.cream, detail, x, 3.18, 0.25); }
      } else {
        const flywheel = mesh(new THREE.TorusGeometry(0.72, 0.13, 10, 24), mats.orange, detail, 0, 1.15, 1.35);
        for (const x of [-0.48, 0, 0.48]) mesh(new THREE.BoxGeometry(0.25, 0.75, 0.18), mats.cyan, detail, x, 1.1, -1.35);
        flywheel.userData.levelFlywheel = true;
      }
    } else {
      if (level === 2) {
        mesh(new THREE.BoxGeometry(1.1, 0.75, 0.8), b.type === "sweeper" ? mats.cream : mats.orange, detail, 0, 1.65, 0.55);
        for (const x of [-0.88, 0.88]) { const brush = mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 12), mats.cyan, detail, x, 0.35, 0.65); brush.rotation.z = Math.PI / 2; }
      } else {
        mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.35, 8), mats.dark, detail, -0.75, 2.2, 0.4);
        mesh(new THREE.SphereGeometry(0.14, 8, 6), mats.cyan, detail, -0.75, 2.93, 0.4);
        for (const x of [-0.35, 0.35]) mesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), mats.cyan, detail, x, 0.42, -0.85);
      }
    }
  }
}

