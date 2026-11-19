import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
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
ice: new THREE.MeshStandardMaterial({ color: 0xe7fdff, emissive: 0x8ad4dc, emissiveIntensity: 0.28, roughness: 0.16, metalness: 0.04 }),
rubber: new THREE.MeshStandardMaterial({ color: 0x1b3038, roughness: 0.88 }),
};

interface DockKit {
  dark: THREE.BufferGeometry; cream: THREE.BufferGeometry; orange: THREE.BufferGeometry; status: THREE.BufferGeometry;
  movingCyan: THREE.BufferGeometry; beacon: THREE.BufferGeometry;
  level2Body: THREE.BufferGeometry; level2Cyan: THREE.BufferGeometry;
  level3Dark: THREE.BufferGeometry; level3Cyan: THREE.BufferGeometry;
}
const dockKits = new Map<"sweeper" | "hauler", DockKit>();

function baked(source: THREE.Mesh): THREE.BufferGeometry {
  const geometry = source.geometry.clone();
  source.updateMatrix();
  geometry.applyMatrix4(source.matrix);
  return geometry;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 1) return parts[0];
  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error("Dock geometry merge failed");
  for (const part of parts) part.dispose();
  return geometry;
}

function collect(root: THREE.Object3D, material: THREE.Material): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const child of root.children) if (child instanceof THREE.Mesh && child.material === material) {
    const geometry = baked(child);
    if (!geometry.index) parts.push(geometry);
    else { const flat = geometry.toNonIndexed(); geometry.dispose(); parts.push(flat); }
  }
  return merged(parts);
}

function dockPart(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
  const part = new THREE.Mesh(geometry, material);
  part.userData.sharedResources = true;
  part.castShadow = true;
  part.receiveShadow = true;
  parent.add(part);
  return part;
}

interface MachineKit {
  dark: THREE.BufferGeometry; cream: THREE.BufferGeometry; orange: THREE.BufferGeometry; cyan: THREE.BufferGeometry; ice: THREE.BufferGeometry | null; status: THREE.BufferGeometry;
  movingDark: THREE.BufferGeometry; movingAccent: THREE.BufferGeometry;
  level2Dark: THREE.BufferGeometry | null; level2Cyan: THREE.BufferGeometry | null; level2Orange: THREE.BufferGeometry | null;
  level3Cream: THREE.BufferGeometry | null; level3Orange: THREE.BufferGeometry | null; level3Cyan: THREE.BufferGeometry | null;
}
const machineKits = new Map<"purifier" | "press", MachineKit>();

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = parts.map((part) => {
    if (!part.index) return part;
    const flat = part.toNonIndexed();
    part.dispose();
    return flat;
  });
  if (prepared.length === 1) return prepared[0];
  return merged(prepared);
}

function collectMaterial(root: THREE.Object3D, material: THREE.Material): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || child.material !== material) return;
    const geometry = child.geometry.clone();
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, child.matrixWorld));
    parts.push(geometry);
  });
  return parts.length ? mergeParts(parts) : null;
}

function machinePart(geometry: THREE.BufferGeometry | null, material: THREE.Material, parent: THREE.Object3D): void {
  if (!geometry) return;
  dockPart(geometry, material, parent);
}

function sculptPurifier(fallback: THREE.Group, moving: THREE.Group, level2: THREE.Group, level3: THREE.Group, status: THREE.Material): void {
  mesh(new RoundedBoxGeometry(1.55, 0.2, 1.05, 2, 0.08), mats.dark, fallback, 0, 0.16, -0.02);
  for (const x of [-0.55, 0.55]) mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.08, 12), mats.orange, fallback, x, 0.06, 0.12);
  const body = mesh(new THREE.SphereGeometry(0.7, 18, 14), mats.cream, fallback, 0, 0.78, -0.08);
  body.scale.set(1.12, 0.7, 0.78);
  const throat = mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.4, 14), mats.dark, fallback, 0, 0.6, 0.62);
  throat.rotation.x = Math.PI / 2;
  const mouth = mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.08, 14), mats.cyan, fallback, 0, 0.6, 0.86);
  mouth.rotation.x = Math.PI / 2;
  const lip = mesh(new THREE.TorusGeometry(0.23, 0.042, 8, 16), mats.orange, fallback, 0, 0.6, 0.88);
  lip.rotation.y = 0;
  const tank = mesh(new THREE.CapsuleGeometry(0.2, 0.38, 4, 10), mats.cyan, fallback, -0.68, 0.92, -0.08);
  const tankBand = mesh(new THREE.TorusGeometry(0.22, 0.032, 6, 12), mats.dark, fallback, -0.68, 0.76, -0.08);
  tankBand.rotation.x = Math.PI / 2;
  const feed = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.36, 8), mats.orange, fallback, -0.36, 0.88, -0.02);
  feed.rotation.z = Math.PI / 2;
  mesh(new RoundedBoxGeometry(0.38, 0.2, 0.06, 2, 0.02), status, fallback, 0.18, 0.92, 0.4);
  mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.14, 10), mats.dark, moving, 0, 1.28, -0.08);
  mesh(new THREE.SphereGeometry(0.09, 8, 6), mats.dark, moving, 0, 1.38, -0.08);
  for (let i = 0; i < 4; i++) {
    const fin = mesh(new THREE.BoxGeometry(0.07, 0.08, 0.42), mats.orange, moving, 0, 1.34, -0.08);
    fin.rotation.y = i * Math.PI / 2;
  }
  mesh(new THREE.CapsuleGeometry(0.18, 0.32, 3, 8), mats.cyan, level2, 0.78, 0.82, -0.12);
  mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.12, 10), mats.dark, level2, 0.78, 0.4, -0.12);
  const elbow = mesh(new THREE.TorusGeometry(0.2, 0.045, 6, 10, Math.PI), mats.orange, level2, 0.46, 1.08, -0.08);
  elbow.rotation.z = Math.PI; elbow.rotation.y = -Math.PI / 2;
  for (const x of [-0.24, 0.24]) mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.36, 8), mats.cream, level3, x, 1.58, -0.06);
  mesh(new RoundedBoxGeometry(0.72, 0.08, 0.14, 2, 0.03), mats.orange, level3, 0, 1.78, -0.06);
  mesh(new THREE.SphereGeometry(0.08, 8, 6), mats.cyan, level3, 0, 1.9, -0.06);
}

function filletedProfile(points: Array<[number, number]>, radius: number): THREE.Shape {
  const corners = points.map(([x, y]) => new THREE.Vector2(x, y));
  const shape = new THREE.Shape();
  const count = corners.length;
  for (let i = 0; i < count; i++) {
    const prev = corners[(i - 1 + count) % count];
    const curr = corners[i];
    const next = corners[(i + 1) % count];
    const inward = curr.clone().sub(prev);
    const outward = next.clone().sub(curr);
    const inLen = inward.length();
    const outLen = outward.length();
    inward.multiplyScalar(1 / inLen);
    outward.multiplyScalar(1 / outLen);
    const r = Math.min(radius, inLen * 0.42, outLen * 0.42);
    const start = curr.clone().addScaledVector(inward, -r);
    const end = curr.clone().addScaledVector(outward, r);
    if (i === 0) shape.moveTo(start.x, start.y);
    else shape.lineTo(start.x, start.y);
    shape.quadraticCurveTo(curr.x, curr.y, end.x, end.y);
  }
  shape.closePath();
  return shape;
}

function pressFrame(points: Array<[number, number]>, depth: number, radius: number): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(filletedProfile(points, radius), {
    depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 6,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.rotateY(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function pressChannel(): THREE.BufferGeometry {
  const channel = new THREE.Shape();
  channel.moveTo(-0.48, 0);
  channel.lineTo(-0.48, 0.22);
  channel.lineTo(-0.28, 0.22);
  channel.lineTo(-0.28, 0.07);
  channel.lineTo(0.28, 0.07);
  channel.lineTo(0.28, 0.22);
  channel.lineTo(0.48, 0.22);
  channel.lineTo(0.48, 0);
  channel.closePath();
  const tray = new THREE.ExtrudeGeometry(channel, { depth: 0.86, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 3 });
  tray.translate(0, 0.46, 0.42);
  tray.computeVertexNormals();
  return tray;
}

function sculptPress(fallback: THREE.Group, moving: THREE.Group, level2: THREE.Group, level3: THREE.Group, status: THREE.Material): void {
  const creamProfile: Array<[number, number]> = [
    [-0.86, 0.12], [1.05, 0.12], [1.05, 0.5], [-0.16, 0.5],
    [-0.16, 1.56], [0.5, 1.56], [0.5, 2.02], [-0.86, 2.02],
  ];
  const darkProfile: Array<[number, number]> = [
    [-0.72, 0.22], [0.92, 0.22], [0.92, 0.64], [0.02, 0.64],
    [0.02, 1.38], [0.34, 1.38], [0.34, 1.88], [-0.72, 1.88],
  ];
  mesh(pressFrame(creamProfile, 1.64, 0.15), mats.cream, fallback);
  mesh(pressFrame(darkProfile, 1.12, 0.11), mats.dark, fallback);
  const belly = mesh(new THREE.CapsuleGeometry(0.28, 1.12, 4, 10), mats.dark, fallback, 0, 0.24, -0.18);
  belly.rotation.z = Math.PI / 2; belly.scale.set(1, 0.7, 1);
  for (const x of [-0.58, 0.58]) mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.1, 14), mats.orange, fallback, x, 0.08, -0.12);
  const crown = mesh(new THREE.CapsuleGeometry(0.22, 1.08, 4, 10), mats.cream, fallback, 0, 2.02, -0.16);
  crown.rotation.z = Math.PI / 2;
  for (const y of [0.36, 1.76]) {
    const knuckle = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 12), mats.orange, fallback, 0, y, -0.82);
    knuckle.rotation.z = Math.PI / 2;
    for (const x of [-0.24, 0.24]) mesh(new THREE.SphereGeometry(0.12, 10, 8), mats.dark, fallback, x, y, -0.82);
  }
  for (const x of [-0.68, 0.68]) {
    mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.98, 12), mats.orange, fallback, x, 1.1, 0.3);
    const collar = mesh(new THREE.TorusGeometry(0.14, 0.038, 8, 14), mats.dark, fallback, x, 1.54, 0.3);
    collar.rotation.x = Math.PI / 2;
    mesh(new THREE.SphereGeometry(0.14, 10, 8), mats.dark, fallback, x, 0.62, 0.3);
  }
  const sleeve = mesh(new THREE.TorusGeometry(0.2, 0.045, 8, 16), mats.orange, fallback, 0, 1.64, 0.18);
  sleeve.rotation.x = Math.PI / 2;
  mesh(new RoundedBoxGeometry(0.5, 0.55, 0.06, 2, 0.03), mats.cyan, fallback, 0, 1.02, 0.0);
  mesh(pressChannel(), mats.orange, fallback);
  mesh(new RoundedBoxGeometry(0.4, 0.3, 0.4, 2, 0.06), mats.ice, fallback, 0, 0.74, 0.68);
  mesh(new RoundedBoxGeometry(0.44, 0.34, 0.44, 2, 0.07), mats.ice, fallback, 0, 0.8, 1.12);
  mesh(new RoundedBoxGeometry(0.34, 0.12, 0.06, 2, 0.03), mats.dark, fallback, 0.34, 1.72, 0.48);
  mesh(new RoundedBoxGeometry(0.2, 0.05, 0.03, 1, 0.015), status, fallback, 0.34, 1.72, 0.52);
  mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.46, 12), mats.dark, moving, 0, 1.68, 0.18);
  const ramCollar = mesh(new THREE.TorusGeometry(0.2, 0.042, 8, 14), mats.dark, moving, 0, 1.48, 0.18);
  ramCollar.rotation.x = Math.PI / 2;
  mesh(new RoundedBoxGeometry(1.08, 0.46, 0.58, 3, 0.14), mats.cyan, moving, 0, 1.24, 0.2);
  for (const x of [-0.96, 0.96]) {
    mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.2, 10), mats.dark, level2, x, 1.28, 0.02);
    mesh(new THREE.CapsuleGeometry(0.12, 0.28, 3, 8), mats.cyan, level2, x, 1.52, 0.02);
  }
  mesh(new RoundedBoxGeometry(1.15, 0.08, 0.28, 2, 0.03), mats.orange, level3, 0, 2.2, -0.12);
  for (const x of [-0.62, 0.62]) mesh(new THREE.SphereGeometry(0.1, 8, 6), mats.cream, level3, x, 2.16, -0.12);
  for (const x of [-0.42, 0.42]) mesh(new THREE.SphereGeometry(0.07, 8, 6), mats.cyan, level3, x, 1.78, 0.5);
}

function sharedMachineKit(type: "purifier" | "press"): MachineKit {
  const existing = machineKits.get(type);
  if (existing) return existing;
  const status = new THREE.MeshStandardMaterial();
  const fallback = new THREE.Group();
  const moving = new THREE.Group();
  const level2 = new THREE.Group();
  const level3 = new THREE.Group();
  if (type === "purifier") sculptPurifier(fallback, moving, level2, level3, status);
  else sculptPress(fallback, moving, level2, level3, status);
  const kit: MachineKit = {
    dark: collectMaterial(fallback, mats.dark)!,
    cream: collectMaterial(fallback, mats.cream)!,
    orange: collectMaterial(fallback, mats.orange)!,
    cyan: collectMaterial(fallback, mats.cyan)!,
    ice: collectMaterial(fallback, mats.ice),
    status: collectMaterial(fallback, status)!,
    movingDark: collectMaterial(moving, mats.dark)!,
    movingAccent: collectMaterial(moving, type === "purifier" ? mats.orange : mats.cyan)!,
    level2Dark: collectMaterial(level2, mats.dark),
    level2Cyan: collectMaterial(level2, mats.cyan),
    level2Orange: collectMaterial(level2, mats.orange),
    level3Cream: collectMaterial(level3, mats.cream),
    level3Orange: collectMaterial(level3, mats.orange),
    level3Cyan: collectMaterial(level3, mats.cyan),
  };
  for (const root of [fallback, moving, level2, level3]) root.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  status.dispose();
  machineKits.set(type, kit);
  return kit;
}

interface UtilityKit {
  dark: THREE.BufferGeometry; cream: THREE.BufferGeometry; orange: THREE.BufferGeometry;
  level2Dark: THREE.BufferGeometry | null; level2Cream: THREE.BufferGeometry | null; level2Orange: THREE.BufferGeometry | null;
  level3Orange: THREE.BufferGeometry | null; level3Cyan: THREE.BufferGeometry | null;
}
const utilityKits = new Map<"heater" | "generator", UtilityKit>();
const utilityGeo = {
  heaterCoil: new THREE.TorusGeometry(0.34, 0.055, 8, 16),
  heaterPulse: new THREE.SphereGeometry(0.09, 8, 6),
  generatorCore: new THREE.SphereGeometry(0.36, 16, 12),
  generatorOrbitA: new THREE.TorusGeometry(0.78, 0.07, 8, 24),
  generatorOrbitB: new THREE.TorusGeometry(0.62, 0.05, 8, 20),
};

function sculptHeater(fallback: THREE.Group, level2: THREE.Group, level3: THREE.Group): void {
  mesh(new THREE.CylinderGeometry(0.56, 0.64, 0.2, 16), mats.dark, fallback, 0, 0.14, 0);
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.07, 10), mats.orange, fallback, Math.sin(angle) * 0.4, 0.05, Math.cos(angle) * 0.4);
  }
  mesh(new THREE.CylinderGeometry(0.26, 0.3, 1.05, 12), mats.dark, fallback, 0, 1.52, 0);
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + Math.PI / 4;
    mesh(new THREE.CapsuleGeometry(0.05, 1.28, 3, 8), mats.cream, fallback, Math.sin(angle) * 0.44, 1.32, Math.cos(angle) * 0.44);
  }
  const hearth = mesh(new THREE.TorusGeometry(0.38, 0.07, 8, 16), mats.orange, fallback, 0, 0.4, 0); hearth.rotation.x = Math.PI / 2;
  const crown = mesh(new THREE.TorusGeometry(0.36, 0.075, 8, 16), mats.cream, fallback, 0, 2.18, 0); crown.rotation.x = Math.PI / 2;
  mesh(new THREE.SphereGeometry(0.2, 12, 10), mats.orange, fallback, 0, 2.38, 0);
  mesh(new RoundedBoxGeometry(0.26, 0.18, 0.07, 2, 0.03), mats.dark, fallback, 0, 0.7, 0.46);
  const warmRing = mesh(new THREE.TorusGeometry(0.48, 0.045, 8, 16), mats.orange, level2, 0, 1.88, 0); warmRing.rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2;
    mesh(new THREE.CapsuleGeometry(0.035, 0.14, 2, 6), mats.cream, level2, Math.sin(angle) * 0.5, 0.52, Math.cos(angle) * 0.5);
  }
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + Math.PI / 4;
    mesh(new THREE.SphereGeometry(0.08, 8, 6), mats.orange, level3, Math.sin(angle) * 0.56, 0.3, Math.cos(angle) * 0.56);
    mesh(new THREE.SphereGeometry(0.045, 8, 6), mats.cyan, level3, Math.sin(angle) * 0.56, 0.46, Math.cos(angle) * 0.56);
  }
}

function sculptGenerator(fallback: THREE.Group, level2: THREE.Group, level3: THREE.Group): void {
  mesh(new THREE.CylinderGeometry(0.78, 0.88, 0.2, 18), mats.dark, fallback, 0, 0.14, 0);
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    mesh(new THREE.SphereGeometry(0.15, 10, 8), mats.orange, fallback, Math.sin(angle) * 0.62, 0.2, Math.cos(angle) * 0.62);
    mesh(new THREE.CapsuleGeometry(0.055, 0.22, 3, 6), mats.orange, fallback, Math.sin(angle) * 0.48, 0.42, Math.cos(angle) * 0.48);
  }
  for (const x of [-0.5, 0.5]) {
    const shoulder = mesh(new THREE.SphereGeometry(0.3, 12, 10), mats.cream, fallback, x, 0.4, 0);
    shoulder.scale.set(1.05, 0.48, 0.75);
  }
  const cradle = mesh(new THREE.TorusGeometry(0.46, 0.09, 8, 16), mats.cream, fallback, 0, 0.62, 0); cradle.rotation.x = Math.PI / 2;
  mesh(new THREE.CapsuleGeometry(0.07, 0.34, 3, 6), mats.cream, fallback, 0, 2.18, 0);
  mesh(new THREE.SphereGeometry(0.11, 10, 8), mats.dark, fallback, 0, 2.46, 0);
  for (const x of [-0.58, 0.58]) {
    mesh(new THREE.CapsuleGeometry(0.04, 0.36, 2, 6), mats.dark, level2, x, 2.12, 0.12);
    mesh(new THREE.SphereGeometry(0.08, 8, 6), mats.cream, level2, x, 2.42, 0.12);
  }
  const flywheel = mesh(new THREE.TorusGeometry(0.26, 0.055, 8, 16), mats.orange, level3, 0, 0.95, 1.02);
  flywheel.rotation.x = Math.PI / 2;
  for (const x of [-0.2, 0, 0.2]) mesh(new THREE.BoxGeometry(0.09, 0.24, 0.07), mats.cyan, level3, x, 0.95, -1.0);
}

function sharedUtilityKit(type: "heater" | "generator"): UtilityKit {
  const existing = utilityKits.get(type);
  if (existing) return existing;
  const fallback = new THREE.Group();
  const level2 = new THREE.Group();
  const level3 = new THREE.Group();
  if (type === "heater") sculptHeater(fallback, level2, level3);
  else sculptGenerator(fallback, level2, level3);
  const kit: UtilityKit = {
    dark: collectMaterial(fallback, mats.dark)!,
    cream: collectMaterial(fallback, mats.cream)!,
    orange: collectMaterial(fallback, mats.orange)!,
    level2Dark: collectMaterial(level2, mats.dark),
    level2Cream: collectMaterial(level2, mats.cream),
    level2Orange: collectMaterial(level2, mats.orange),
    level3Orange: collectMaterial(level3, mats.orange),
    level3Cyan: collectMaterial(level3, mats.cyan),
  };
  for (const root of [fallback, level2, level3]) root.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  utilityKits.set(type, kit);
  return kit;
}

function utilityMesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, shadow = true): THREE.Mesh {
  const part = new THREE.Mesh(geometry, material);
  part.userData.sharedResources = true;
  part.castShadow = shadow;
  part.receiveShadow = shadow;
  parent.add(part);
  return part;
}

function sharedDockKit(type: "sweeper" | "hauler"): DockKit {
  const existing = dockKits.get(type);
  if (existing) return existing;
  const status = new THREE.MeshStandardMaterial();
  const fallback = new THREE.Group();
  const moving = new THREE.Group();
  const level2 = new THREE.Group();
  const level3 = new THREE.Group();
  mesh(new THREE.CylinderGeometry(1.22, 1.34, 0.2, 20), mats.dark, fallback, 0, 0.14);
  const deck = mesh(new THREE.SphereGeometry(1.08, 16, 12), mats.cream, fallback, 0, 0.26, 0); deck.scale.set(1.05, 0.12, 0.78);
  const chargePad = mesh(new THREE.TorusGeometry(0.68, 0.048, 8, 24), status, fallback, 0, 0.4, 0); chargePad.rotation.x = Math.PI / 2;
  for (const x of [-0.98, 0.98]) {
    mesh(new THREE.CapsuleGeometry(0.11, 1.05, 3, 8), mats.orange, fallback, x, 0.95, 0.08);
    mesh(new THREE.SphereGeometry(0.18, 10, 8), mats.dark, fallback, x, 0.26, 0.08);
  }
  const canopy = mesh(new THREE.SphereGeometry(1.02, 16, 10), type === "sweeper" ? mats.orange : mats.cream, fallback, 0, 1.72, 0.05);
  canopy.scale.set(1.12, 0.26, 0.58);
  mesh(new RoundedBoxGeometry(1.05, 0.62, 0.32, 2, 0.08), mats.dark, fallback, 0, 1.08, 0.48);
  mesh(new RoundedBoxGeometry(0.56, 0.24, 0.05, 2, 0.02), status, fallback, 0, 1.16, 0.66);
  for (const x of [-0.42, 0.42]) mesh(new THREE.CapsuleGeometry(0.09, 0.42, 3, 6), type === "sweeper" ? mats.cream : mats.orange, fallback, x, 0.78, 0.72);
  if (type === "sweeper") {
    for (const x of [-0.46, 0.46]) { const brush = mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.32, 12), mats.cyan, moving, x, 0.46, -0.66); brush.rotation.z = Math.PI / 2; }
  } else {
    for (const x of [-0.38, 0.38]) mesh(new RoundedBoxGeometry(0.38, 0.32, 0.38, 2, 0.07), mats.cyan, moving, x, 0.55, -0.66);
  }
  mesh(new THREE.CapsuleGeometry(0.035, 0.55, 2, 6), mats.dark, fallback, 0.7, 2.15, 0.12);
  mesh(new THREE.SphereGeometry(0.11, 8, 6), status, moving, 0.7, 2.55, 0.12);
  mesh(new RoundedBoxGeometry(0.9, 0.55, 0.55, 2, 0.08), type === "sweeper" ? mats.cream : mats.orange, level2, 0, 1.35, 0.28);
  for (const x of [-0.88, 0.88]) { const brush = mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 12), mats.cyan, level2, x, 0.35, 0.65); brush.rotation.z = Math.PI / 2; }
  mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.35, 8), mats.dark, level3, -0.75, 2.2, 0.4);
  mesh(new THREE.SphereGeometry(0.14, 8, 6), mats.cyan, level3, -0.75, 2.93, 0.4);
  for (const x of [-0.35, 0.35]) mesh(new THREE.BoxGeometry(0.5, 0.45, 0.5), mats.cyan, level3, x, 0.42, -0.85);
  const kit: DockKit = {
    dark: collect(fallback, mats.dark),
    cream: collect(fallback, mats.cream),
    orange: collect(fallback, mats.orange),
    status: collect(fallback, status),
    movingCyan: collect(moving, mats.cyan),
    beacon: collect(moving, status),
    level2Body: collect(level2, type === "sweeper" ? mats.cream : mats.orange),
    level2Cyan: collect(level2, mats.cyan),
    level3Dark: collect(level3, mats.dark),
    level3Cyan: collect(level3, mats.cyan),
  };
  for (const root of [fallback, moving, level2, level3]) root.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  status.dispose();
  dockKits.set(type, kit);
  return kit;
}

export function makeBuildingVisual(type: BuildingType, status: THREE.MeshStandardMaterial): { group: THREE.Group; ring: THREE.Mesh; fallback: THREE.Group; moving: THREE.Group } {
  const group = new THREE.Group(); const fallback = new THREE.Group(); const moving = new THREE.Group(); group.add(fallback, moving);
  const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  const ring = mesh(new THREE.RingGeometry(0.975, 1, type === "generator" ? 96 : 48), ringMat, group, 0, 0.07);
  ring.scale.setScalar(type === "heater" ? 7 : type === "generator" ? generatorRadius(1) : 2);
  ring.rotation.x = -Math.PI / 2; ring.castShadow = false;
  if (type === "purifier") { fallback.scale.setScalar(1.25); moving.scale.setScalar(1.25); ring.scale.setScalar(2.5); }
  if (type === "purifier" || type === "press") {
    const kit = sharedMachineKit(type);
    machinePart(kit.dark, mats.dark, fallback);
    machinePart(kit.cream, mats.cream, fallback);
    machinePart(kit.orange, mats.orange, fallback);
    machinePart(kit.cyan, mats.cyan, fallback);
    machinePart(kit.ice, mats.ice, fallback);
    machinePart(kit.status, status, fallback);
    machinePart(kit.movingDark, mats.dark, moving);
    machinePart(kit.movingAccent, type === "purifier" ? mats.orange : mats.cyan, moving);
  } else if (type === "heater") {
    const kit = sharedUtilityKit("heater");
    machinePart(kit.dark, mats.dark, fallback);
    machinePart(kit.cream, mats.cream, fallback);
    machinePart(kit.orange, mats.orange, fallback);
    const coils: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const coil = utilityMesh(utilityGeo.heaterCoil, status, moving);
      coil.position.y = 1.32 + i * 0.36; coil.rotation.x = Math.PI / 2; coils.push(coil);
    }
    const pulses: THREE.Mesh[] = [];
    for (let i = 0; i < 2; i++) {
      const pulse = utilityMesh(utilityGeo.heaterPulse, mats.cyan, moving, false);
      pulse.position.y = 1.35 + i * 0.5; pulses.push(pulse);
    }
    moving.userData.coils = coils; moving.userData.pulses = pulses;
  } else if (type === "generator") {
    const kit = sharedUtilityKit("generator");
    machinePart(kit.dark, mats.dark, fallback);
    machinePart(kit.cream, mats.cream, fallback);
    machinePart(kit.orange, mats.orange, fallback);
    const core = utilityMesh(utilityGeo.generatorCore, status, moving); core.name = "generator-core"; core.position.y = 1.15;
    const orbitA = utilityMesh(utilityGeo.generatorOrbitA, mats.cyan, moving); orbitA.position.y = 1.15; orbitA.rotation.x = Math.PI / 2.8;
    const orbitB = utilityMesh(utilityGeo.generatorOrbitB, mats.orange, moving); orbitB.position.y = 1.15; orbitB.rotation.y = Math.PI / 2;
  } else {
    const kit = sharedDockKit(type === "hauler" ? "hauler" : "sweeper");
    dockPart(kit.dark, mats.dark, fallback);
    dockPart(kit.cream, mats.cream, fallback);
    dockPart(kit.orange, mats.orange, fallback);
    dockPart(kit.status, status, fallback);
    dockPart(kit.movingCyan, mats.cyan, moving);
    dockPart(kit.beacon, status, moving);
  }
  return { group, ring, fallback, moving };
}


export function createLevelDetails(b: BuildingEntity): void {
  for (const level of [2, 3]) {
    const detail = new THREE.Group(); detail.name = `upgrade-level-${level}`; detail.userData.upgradeLevel = level;
    detail.visible = b.level >= level; b.group.add(detail); b.levelDetails.push(detail);
    if (b.type === "purifier" || b.type === "press") {
      const kit = sharedMachineKit(b.type);
      if (level === 2) {
        machinePart(kit.level2Dark, mats.dark, detail);
        machinePart(kit.level2Cyan, mats.cyan, detail);
        machinePart(kit.level2Orange, mats.orange, detail);
      } else {
        machinePart(kit.level3Cream, mats.cream, detail);
        machinePart(kit.level3Orange, mats.orange, detail);
        machinePart(kit.level3Cyan, mats.cyan, detail);
      }
    } else if (b.type === "heater" || b.type === "generator") {
      const kit = sharedUtilityKit(b.type);
      if (level === 2) {
        machinePart(kit.level2Dark, mats.dark, detail);
        machinePart(kit.level2Cream, mats.cream, detail);
        machinePart(kit.level2Orange, mats.orange, detail);
      } else {
        machinePart(kit.level3Orange, mats.orange, detail);
        machinePart(kit.level3Cyan, mats.cyan, detail);
        const flywheel = detail.children.find((child) => child instanceof THREE.Mesh && child.material === mats.orange);
        if (b.type === "generator" && flywheel) flywheel.userData.levelFlywheel = true;
      }
    } else {
      const kit = sharedDockKit(b.type === "hauler" ? "hauler" : "sweeper");
      if (level === 2) {
        dockPart(kit.level2Body, b.type === "sweeper" ? mats.cream : mats.orange, detail);
        dockPart(kit.level2Cyan, mats.cyan, detail);
      } else {
        dockPart(kit.level3Dark, mats.dark, detail);
        dockPart(kit.level3Cyan, mats.cyan, detail);
      }
    }
  }
}

