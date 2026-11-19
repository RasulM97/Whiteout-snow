import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { COLORS, GAME } from "./config";
import { groundHeight, type CircleZone, type SnowField } from "./snow";
import type { CoreId, Language } from "./types";
import { translate } from "./i18n";
import { createSnowPineGeometries } from "./nature";

export interface CoreEntity {
  id: CoreId; x: number; z: number; scanned: boolean; revealed: boolean; recovered: boolean;
  body: THREE.Group; marker: THREE.Group; beam: THREE.MeshBasicMaterial;
}
const CORE_DATA = [
  { id: "comms" as const, x: -36.45, z: -29.7 },
  { id: "habitat" as const, x: 40.5, z: -25.65 },
  { id: "command" as const, x: -40.5, z: 39.15 },
];
function seeded(seed: number): () => number {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function mergedGeometry(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error("Structure geometry merge failed");
  for (const part of parts) part.dispose();
  return geometry;
}
function fabPart(parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const part = new THREE.Mesh(geometry, material);
  part.position.set(x, y, z);
  parent.add(part);
  return part;
}
function fabBox(w: number, h: number, d: number, r = 0.08): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w * 0.45, h * 0.45, d * 0.45));
}
function fabArm(parent: THREE.Group, material: THREE.Material, ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number): void {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const length = dir.length();
  const limb = fabPart(parent, new THREE.CapsuleGeometry(radius, Math.max(0.04, length - radius * 2), 3, 8), material, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  limb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.multiplyScalar(1 / length));
}
function assembleFabricator(cream: THREE.Material, dark: THREE.Material, cavity: THREE.Material, orange: THREE.Material, workpiece: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  group.rotation.y = 0.42;
  const chassis = fabPart(group, new THREE.SphereGeometry(1, 28, 18), cream, 0.02, 0.36, 0.04);
  chassis.scale.set(0.9, 0.26, 0.5);
  const belly = fabPart(group, new THREE.CapsuleGeometry(0.16, 0.8, 4, 10), dark, 0, 0.22, 0);
  belly.rotation.z = Math.PI / 2;
  for (const [x, z] of [[-0.48, -0.06], [0.52, 0.16]] as const) {
    fabPart(group, new THREE.CylinderGeometry(0.15, 0.18, 0.08, 14), orange, x, 0.07, z);
    const ankle = fabPart(group, new THREE.TorusGeometry(0.16, 0.026, 8, 14), dark, x, 0.11, z);
    ankle.rotation.x = Math.PI / 2;
  }
  const rear = fabPart(group, new THREE.SphereGeometry(1, 26, 16), cream, -0.04, 0.96, -0.34);
  rear.scale.set(0.78, 0.56, 0.32);
  const leftCheek = fabPart(group, new THREE.SphereGeometry(1, 22, 14), cream, -0.55, 0.98, 0.08);
  leftCheek.scale.set(0.26, 0.5, 0.4);
  const rightCheek = fabPart(group, new THREE.SphereGeometry(1, 22, 14), cream, 0.52, 0.58, 0.08);
  rightCheek.scale.set(0.3, 0.34, 0.4);
  fabArm(group, cream, -0.46, 1.32, -0.08, 0.16, 1.18, 0.1, 0.17);
  fabArm(group, cream, -0.42, 0.62, 0.02, -0.08, 0.42, 0.02, 0.18);
  fabPart(group, fabBox(0.7, 0.58, 0.18, 0.05), cavity, -0.02, 0.94, 0.08);
  fabPart(group, fabBox(0.64, 0.08, 0.4, 0.03), cavity, -0.02, 0.66, 0.18);
  const hinge = fabPart(group, new THREE.CylinderGeometry(0.055, 0.055, 0.7, 14), orange, -0.16, 1.34, -0.02);
  hinge.rotation.z = Math.PI / 2;
  for (const x of [-0.5, 0.18]) {
    const collar = fabPart(group, new THREE.TorusGeometry(0.1, 0.028, 8, 14), dark, x, 1.34, -0.02);
    collar.rotation.y = Math.PI / 2;
  }
  const hopper = fabPart(group, new THREE.CapsuleGeometry(0.16, 0.16, 4, 12), cream, -0.86, 0.84, -0.02);
  hopper.rotation.z = Math.PI / 2;
  const band = fabPart(group, new THREE.TorusGeometry(0.175, 0.03, 8, 16), orange, -0.9, 0.84, -0.02);
  band.rotation.y = Math.PI / 2;
  const neck = fabPart(group, new THREE.TorusGeometry(0.18, 0.04, 8, 16), dark, -0.68, 0.86, 0);
  neck.rotation.y = Math.PI / 2;
  const throat = fabPart(group, new THREE.CylinderGeometry(0.08, 0.1, 0.18, 12), dark, -0.56, 0.88, 0.06);
  throat.rotation.z = Math.PI / 2;
  const blank = fabPart(group, fabBox(0.44, 0.32, 0.3, 0.07), workpiece, -0.02, 0.92, 0.32);
  blank.rotation.y = 0.12;
  const groove = fabPart(group, fabBox(0.46, 0.04, 0.32, 0.012), cavity, -0.02, 0.92, 0.32);
  groove.rotation.y = 0.12;
  fabPart(group, new THREE.CylinderGeometry(0.055, 0.07, 0.18, 12), orange, -0.02, 1.18, 0.3);
  const spindleRing = fabPart(group, new THREE.TorusGeometry(0.1, 0.026, 8, 14), dark, -0.02, 1.26, 0.3);
  spindleRing.rotation.x = Math.PI / 2;
  fabPart(group, new THREE.SphereGeometry(0.13, 12, 10), dark, -0.3, 1.04, 0.24);
  const leftSocket = fabPart(group, new THREE.TorusGeometry(0.15, 0.03, 8, 14), dark, -0.3, 1.04, 0.3);
  leftSocket.rotation.y = 0.5;
  fabArm(group, orange, -0.3, 1.04, 0.24, -0.58, 1.18, 0.42, 0.105);
  fabPart(group, new THREE.SphereGeometry(0.11, 12, 8), dark, -0.58, 1.18, 0.42);
  fabArm(group, orange, -0.58, 1.18, 0.42, -0.14, 0.96, 0.36, 0.09);
  const leftA = fabPart(group, fabBox(0.1, 0.22, 0.14, 0.03), orange, -0.18, 0.84, 0.4);
  leftA.rotation.z = 0.55;
  const leftB = fabPart(group, fabBox(0.1, 0.2, 0.12, 0.03), orange, -0.12, 1.02, 0.28);
  leftB.rotation.z = -0.4;
  fabPart(group, new THREE.SphereGeometry(0.12, 12, 8), dark, 0.16, 0.74, 0.24);
  const rightSocket = fabPart(group, new THREE.TorusGeometry(0.14, 0.028, 8, 14), dark, 0.16, 0.74, 0.3);
  rightSocket.rotation.x = 1;
  fabArm(group, orange, 0.16, 0.74, 0.24, 0.42, 0.64, 0.42, 0.095);
  fabPart(group, new THREE.SphereGeometry(0.1, 10, 8), dark, 0.42, 0.64, 0.42);
  fabArm(group, orange, 0.42, 0.64, 0.42, 0.08, 0.9, 0.36, 0.085);
  const rightA = fabPart(group, fabBox(0.09, 0.18, 0.12, 0.03), orange, 0.12, 0.8, 0.4);
  rightA.rotation.z = -0.5;
  const rightB = fabPart(group, fabBox(0.08, 0.16, 0.11, 0.025), orange, 0.06, 0.98, 0.3);
  rightB.rotation.z = 0.35;
  fabPart(group, fabBox(0.36, 0.07, 0.28, 0.03), orange, 0.5, 0.4, 0.22);
  fabPart(group, fabBox(0.09, 0.18, 0.32, 0.03), cream, 0.32, 0.5, 0.24);
  fabPart(group, fabBox(0.09, 0.16, 0.3, 0.03), cream, 0.68, 0.48, 0.22);
  fabPart(group, fabBox(0.3, 0.1, 0.08, 0.025), cavity, 0.5, 0.48, 0.12);
  fabPart(group, fabBox(0.2, 0.12, 0.16, 0.035), workpiece, 0.5, 0.46, 0.26);
  return group;
}
function takeFabricator(root: THREE.Group, material: THREE.Material): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.material !== material) return;
    const geometry = object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    parts.push(geometry);
  });
  return mergeFabricator(parts);
}

function mergeFabricator(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = parts.map((part) => {
    if (!part.index) return part;
    const flat = part.toNonIndexed();
    part.dispose();
    return flat;
  });
  return mergedGeometry(prepared);
}
export function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function paintLabel(sprite: THREE.Sprite, text: string, color: string): void {
  const material = sprite.material as THREE.SpriteMaterial; const canvas = material.map!.image as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!; ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(9,31,39,.9)"; ctx.roundRect(8, 20, 496, 88, 26); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = color;
  const lang = document.documentElement.lang;
  const family = lang === "fa" ? "Vazirmatn" : lang === "zh-CN" ? '"Noto Sans SC"' : "Inter";
  let size = 38; do { ctx.font = `700 ${size}px ${family}, sans-serif`; size -= 2; } while (ctx.measureText(text).width > 448 && size > 20);
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, 256, 65, 448); material.map!.needsUpdate = true;
}
function label(text: string, color = "#8ef5ed", key = "", index = -1): THREE.Sprite {
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 128;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.userData = { translationKey: key, labelColor: color, labelIndex: index }; sprite.scale.set(4.2, 1.05, 1); paintLabel(sprite, text, color); return sprite;
}

export class World {
  readonly group = new THREE.Group();
  readonly obstacles: CircleZone[] = [];
  readonly vista: CircleZone[] = [];
  readonly cores: CoreEntity[] = [];
  readonly depotPos = new THREE.Vector3(GAME.depot.x, 0, GAME.depot.z);
  readonly fabricatorPos = new THREE.Vector3(GAME.fabricator.x, 0, GAME.fabricator.z);
  private beaconMaterials: THREE.MeshStandardMaterial[] = [];
  private flags: THREE.Mesh[] = [];
  private aurora: THREE.Mesh;
  private collisionResult = { x: 0, z: 0 };
  private navMarkers: THREE.Group[] = [];
  private objectiveMarker = new THREE.Group();
  private heaterSitesGroup = new THREE.Group();
  private heaterSiteMarkers: THREE.Group[] = [];
  readonly heaterSites = [
    { x: -12, z: -2 }, { x: 12, z: -2 },
    { x: -13, z: 22 }, { x: 13, z: 22 },
  ];

  constructor(private scene: THREE.Scene) {
    scene.add(this.group);
    const groundGeo = new THREE.PlaneGeometry(GAME.worldSize * 1.45, GAME.worldSize * 1.45, 100, 100);
    const groundPos = groundGeo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < groundPos.count; i++) groundPos.setZ(i, groundHeight(groundPos.getX(i), -groundPos.getY(i)) - 0.045);
    groundPos.needsUpdate = true; groundGeo.computeVertexNormals();
    const ground = mesh(groundGeo, new THREE.MeshStandardMaterial({ color: 0x456c72, roughness: 0.88, metalness: 0.06 }), this.group);
    ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
    this.buildRoads(); this.buildBase(); this.buildDistricts(); this.buildNature(); this.buildCores(); this.buildBackdrop();
    this.aurora = this.buildAurora(); this.buildObjectiveMarker(); this.buildHeaterSites();
  }

  private buildRoads(): void {
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x365760, roughness: 0.95 });
    for (const [x, z, w, h, r] of [[0, -8, 5, 46, 0], [0, 24, 5, 25, 0], [14, 4, 32, 4, 0.15], [-17, 2, 34, 4, -0.1]] as const) {
      const geometry = new THREE.PlaneGeometry(w, h, Math.ceil(w / 1.5), Math.ceil(h / 1.5));
      const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
      const cos = Math.cos(r), sin = Math.sin(r);
      for (let i = 0; i < positions.count; i++) {
        const lx = positions.getX(i), ly = positions.getY(i);
        const worldX = x + cos * lx - sin * ly, worldZ = z - sin * lx - cos * ly;
        // Local Z becomes world Y after the road is laid flat. Sample the exact
        // same surface as the snow and Rapier heightfield at every road vertex.
        positions.setZ(i, groundHeight(worldX, worldZ) + 0.012);
      }
      positions.needsUpdate = true; geometry.computeVertexNormals();
      const road = mesh(geometry, roadMat, this.group, x, 0, z); road.rotation.x = -Math.PI / 2; road.rotation.z = r; road.castShadow = false;
    }
  }

  private buildBase(): void {
    const platform = mesh(new THREE.CylinderGeometry(9.4, 9.8, 0.25, 48), new THREE.MeshStandardMaterial({ color: 0x294852, roughness: 0.68, metalness: 0.3 }), this.group, 0, 0.04, 10);
    platform.receiveShadow = true;
    const heatRing = mesh(new THREE.RingGeometry(8.85, 9.05, 64), new THREE.MeshBasicMaterial({ color: COLORS.warm, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }), this.group, 0, 0.18, 10);
    heatRing.rotation.x = -Math.PI / 2; heatRing.castShadow = false;
    const hub = new THREE.Group(); hub.name = "main-spaceship-base"; hub.position.set(0, 0, 15); this.group.add(hub);
    const cream = new THREE.MeshStandardMaterial({ color: 0xd8e1dc, roughness: 0.52, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x29434e, roughness: 0.48, metalness: 0.48 });
    const orange = new THREE.MeshStandardMaterial({ color: COLORS.orange, roughness: 0.42, metalness: 0.24 });
    const hull = mesh(new THREE.SphereGeometry(1, 32, 20), cream, hub, 0, 2.35, 0); hull.scale.set(3.25, 1.45, 3.85);
    const belly = mesh(new THREE.SphereGeometry(1, 24, 14), dark, hub, 0, 1.45, 0.3); belly.scale.set(2.75, 0.72, 3.3);
    const cockpitMat = new THREE.MeshStandardMaterial({ color: 0x79e7ed, emissive: 0x185e70, emissiveIntensity: 1.25, roughness: 0.16, metalness: 0.35 });
    const cockpit = mesh(new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), cockpitMat, hub, 0, 3.15, -2.15); cockpit.scale.set(1.75, 1.1, 1.55); cockpit.rotation.x = -0.18;
    for (const side of [-1, 1]) {
      const wing = mesh(new THREE.BoxGeometry(2.8, 0.28, 2.4), orange, hub, side * 3.25, 1.8, 0.75); wing.rotation.y = side * -0.24; wing.rotation.z = side * -0.08;
      const wingTip = mesh(new THREE.BoxGeometry(0.35, 0.65, 2.1), dark, hub, side * 4.55, 1.95, 0.95); wingTip.rotation.y = side * -0.24;
      const leg = mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.45, 10), dark, hub, side * 2.25, 0.75, 1.25); leg.rotation.z = side * -0.28;
      mesh(new THREE.CylinderGeometry(0.65, 0.78, 0.18, 16), orange, hub, side * 2.45, 0.12, 1.25);
      const engine = mesh(new THREE.CylinderGeometry(0.62, 0.78, 1.4, 18), dark, hub, side * 1.45, 2.05, 3.15); engine.rotation.x = Math.PI / 2;
    }
    const glow = new THREE.MeshStandardMaterial({ color: COLORS.cyan, emissive: COLORS.cyan, emissiveIntensity: 2, roughness: 0.3 }); this.beaconMaterials.push(glow);
    for (const side of [-1, 1]) { const jet = mesh(new THREE.CircleGeometry(0.52, 20), glow, hub, side * 1.45, 2.05, 3.88); jet.rotation.y = Math.PI; }
    for (const side of [-1, 1]) mesh(new THREE.BoxGeometry(0.55, 0.18, 1.25), orange, hub, side * 2.25, 2.7, -1.3);
    const aerial = mesh(new THREE.CylinderGeometry(0.045, 0.09, 1.65, 8), dark, hub, 0.9, 4.25, 0.45);
    mesh(new THREE.SphereGeometry(0.16, 10, 8), glow, aerial, 0, 0.88);
    this.obstacles.push({ x: 0, z: 15, r: 3.85 });

    const depot = new THREE.Group(); depot.name = "sales-depot"; depot.position.copy(this.depotPos); this.group.add(depot);
    const depotBase = new THREE.CylinderGeometry(1.62, 1.72, 0.36, 20); depotBase.translate(0, 0.18, 0);
    const depotMouth = new THREE.CapsuleGeometry(0.28, 0.7, 3, 10); depotMouth.rotateZ(Math.PI / 2); depotMouth.translate(0, 0.72, -1.42);
    mesh(mergedGeometry([depotBase, depotMouth]), dark, depot);
    const depotBody = new THREE.CylinderGeometry(1.46, 1.58, 1.72, 20); depotBody.translate(0, 1.22, 0);
    mesh(depotBody, cream, depot);
    const depotDome = new THREE.SphereGeometry(1.42, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5); depotDome.scale(1, 0.7, 1); depotDome.translate(0, 2.05, 0);
    const depotAwning = new THREE.BoxGeometry(1.05, 0.08, 0.32); depotAwning.translate(0, 1.05, -1.5);
    mesh(mergedGeometry([depotDome, depotAwning]), orange, depot);
    const depotBand = new THREE.TorusGeometry(1.5, 0.07, 8, 28); depotBand.rotateX(Math.PI / 2); depotBand.translate(0, 1.62, 0);
    const depotSlot = new THREE.BoxGeometry(0.78, 0.28, 0.08); depotSlot.translate(0, 0.72, -1.66);
    mesh(mergedGeometry([depotBand, depotSlot]), glow, depot);
    const depotLabel = label("SALES DEPOT", "#ffcf78", "world.depot"); depotLabel.position.set(0, 3.65, 0); depot.add(depotLabel);
    this.addNavigationMarker(depot, 0xffb55f, 4.8);
    this.obstacles.push({ x: GAME.depot.x, z: GAME.depot.z, r: 1.8 });

    const fab = new THREE.Group(); fab.name = "fabricator"; fab.position.copy(this.fabricatorPos); this.group.add(fab);
    const cavity = new THREE.MeshStandardMaterial({ color: 0x17313a, roughness: 0.62, metalness: 0.32 });
    const workpiece = new THREE.MeshStandardMaterial({ color: 0xc9fbff, emissive: 0x1f8f9c, emissiveIntensity: 0.62, roughness: 0.24, metalness: 0.06 });
    const assembled = assembleFabricator(cream, dark, cavity, orange, workpiece);
    mesh(takeFabricator(assembled, cream), cream, fab);
    mesh(takeFabricator(assembled, dark), dark, fab);
    mesh(takeFabricator(assembled, cavity), cavity, fab);
    mesh(takeFabricator(assembled, orange), orange, fab);
    mesh(takeFabricator(assembled, workpiece), workpiece, fab);
    assembled.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    const fabLabel = label("TOOLS + GEAR", "#8ef5ed", "world.fabricator"); fabLabel.position.set(0, 2.55, 0); fab.add(fabLabel);
    this.addNavigationMarker(fab, COLORS.cyan, 4.25);
    this.obstacles.push({ x: GAME.fabricator.x, z: GAME.fabricator.z, r: 1.25 });
    const warm = new THREE.PointLight(COLORS.warm, 24, 18, 2); warm.position.set(0, 4, 10); this.group.add(warm);
    for (const [x, z] of [[-8, 14], [8, 14], [-5, 3], [5, 3]] as const) this.addLamp(x, z);
  }

  baseVisual(): { spaceship: boolean; meshes: number } {
    const ship = this.group.getObjectByName("main-spaceship-base"); let meshes = 0;
    ship?.traverse((object) => { if (object instanceof THREE.Mesh) meshes++; });
    return { spaceship: !!ship && meshes >= 15, meshes };
  }

  private addNavigationMarker(parent: THREE.Group, color: number, height: number): void {
    const marker = new THREE.Group(); marker.position.y = height; marker.userData.baseY = height; parent.add(marker);
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82, depthWrite: false, toneMapped: false });
    const arrow = mesh(new THREE.ConeGeometry(0.36, 0.72, 6), material, marker, 0, 0, 0); arrow.rotation.x = Math.PI; arrow.castShadow = false;
    const beam = mesh(new THREE.CylinderGeometry(0.055, 0.18, 2.1, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }), marker, 0, 1.25, 0); beam.castShadow = false;
    this.navMarkers.push(marker);
  }

  private buildObjectiveMarker(): void {
    const ring = mesh(new THREE.RingGeometry(0.8, 1.02, 32), new THREE.MeshBasicMaterial({ color: COLORS.warm, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }), this.objectiveMarker, 0, 0.08);
    ring.rotation.x = -Math.PI / 2; ring.castShadow = false;
    const arrow = mesh(new THREE.ConeGeometry(0.42, 0.9, 6), new THREE.MeshBasicMaterial({ color: COLORS.warm, toneMapped: false }), this.objectiveMarker, 0, 3.5); arrow.rotation.x = Math.PI; arrow.castShadow = false;
    this.objectiveMarker.visible = false; this.group.add(this.objectiveMarker);
  }

  setObjective(x: number, z: number, visible: boolean): void {
    this.objectiveMarker.visible = visible;
    if (visible) this.objectiveMarker.position.set(x, groundHeight(x, z) + 0.04, z);
  }

  private addLamp(x: number, z: number): void {
    const pole = new THREE.Group(); pole.position.set(x, groundHeight(x, z), z); this.group.add(pole);
    mesh(new THREE.CylinderGeometry(0.06, 0.11, 3.3, 8), new THREE.MeshStandardMaterial({ color: 0x526e77, metalness: 0.55 }), pole, 0, 1.65);
    const lampMat = new THREE.MeshStandardMaterial({ color: COLORS.warm, emissive: COLORS.warm, emissiveIntensity: 2.6 }); this.beaconMaterials.push(lampMat);
    mesh(new THREE.SphereGeometry(0.23, 10, 8), lampMat, pole, 0, 3.25);
    mesh(new THREE.ConeGeometry(0.4, 0.25, 10), new THREE.MeshStandardMaterial({ color: 0x29444e }), pole, 0, 3.5);
  }

  private buildDistricts(): void {
    const shell = new THREE.MeshStandardMaterial({ color: 0xd8e1dc, roughness: 0.55, metalness: 0.18 });
    const trim = new THREE.MeshStandardMaterial({ color: COLORS.orange, roughness: 0.45, metalness: 0.22 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x29434e, roughness: 0.5, metalness: 0.45 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x72e2df, emissive: 0x227f87, emissiveIntensity: 1.1, roughness: 0.25 });
    for (const [x, z, yaw] of [[36.45, -10.8, 0.2], [43.2, 4.05, Math.PI / 2], [-36.45, 20.25, -0.25]] as const) {
      const hab = new THREE.Group(); hab.position.set(x, groundHeight(x, z), z); hab.rotation.y = yaw; this.group.add(hab);
      const hull = mesh(new THREE.CapsuleGeometry(1.35, 3.1, 5, 12), shell, hab, 0, 1.7, 0); hull.rotation.z = Math.PI / 2;
      const belly = mesh(new THREE.SphereGeometry(1.45, 16, 10), dark, hab, 0, 0.85, 0.15); belly.scale.set(1.7, 0.38, 0.85);
      for (const sx of [-1.7, 0, 1.7]) { const rib = mesh(new THREE.TorusGeometry(1.4, 0.09, 8, 18), trim, hab, sx, 1.7, 0); rib.rotation.y = Math.PI / 2; }
      for (const sx of [-1.15, 0.15, 1.35]) mesh(new THREE.BoxGeometry(0.62, 0.36, 0.12), glass, hab, sx, 1.78, 1.42);
      mesh(new THREE.BoxGeometry(0.7, 0.9, 0.16), dark, hab, -0.2, 0.7, 1.32);
      for (const sx of [-1.9, 1.9]) mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.7, 8), trim, hab, sx, 0.35, 0.2);
      this.obstacles.push({ x, z, r: 3.65 });
    }
    for (const [x, z] of [[27, -37.8], [-47.25, -10.8], [37.8, 39.15], [-20.25, 47.25]] as const) this.addLamp(x, z);
  }

  private buildHeaterSites(): void {
    this.group.add(this.heaterSitesGroup);
    for (let i = 0; i < this.heaterSites.length; i++) {
      const site = this.heaterSites[i]; const marker = new THREE.Group();
      marker.position.set(site.x, groundHeight(site.x, site.z) + 0.08, site.z);
      marker.userData.baseY = marker.position.y;
      const ring = mesh(new THREE.RingGeometry(2.15, 2.35, 40), new THREE.MeshBasicMaterial({ color: COLORS.warm, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }), marker);
      ring.rotation.x = -Math.PI / 2; ring.castShadow = false;
      const inner = mesh(new THREE.RingGeometry(0.45, 0.55, 24), new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }), marker, 0, 0.025);
      inner.rotation.x = -Math.PI / 2; inner.castShadow = false;
      const tag = label(`HEATER ${i + 1}`, "#ffd58d", "world.heater", i); tag.position.y = 1.25; tag.scale.set(2.5, 0.63, 1); marker.add(tag);
      this.heaterSiteMarkers.push(marker); this.heaterSitesGroup.add(marker);
    }
    this.heaterSitesGroup.visible = false;
  }

  setHeaterSitesVisible(visible: boolean): void { this.heaterSitesGroup.visible = visible; }
  setLanguage(language: Language): void {
    const paint = () => {
      this.group.traverse((object) => {
        if (!(object instanceof THREE.Sprite) || !object.userData.translationKey) return;
        const key = object.userData.translationKey as string;
        const text = object.userData.labelIndex >= 0 ? `${translate(language, key)} ${object.userData.labelIndex + 1}` : translate(language, key);
        paintLabel(object, text, object.userData.labelColor as string);
      });
    };
    paint();
    const family = language === "fa" ? "700 38px Vazirmatn" : language === "zh" ? '700 38px "Noto Sans SC"' : "700 38px Inter";
    void document.fonts.load(family).then(paint);
  }

  private buildNature(): void {
    const random = seeded(GAME.seed + 12); const count = 62;
    const pine = createSnowPineGeometries();
    const trunks = new THREE.InstancedMesh(pine.trunk, new THREE.MeshStandardMaterial({ color: 0x4a4139, roughness: 0.94 }), count);
    const pines = new THREE.InstancedMesh(pine.foliage, new THREE.MeshStandardMaterial({ color: 0x1c514f, roughness: 0.9, flatShading: true }), count);
    const branchSnow = new THREE.InstancedMesh(pine.snow, new THREE.MeshStandardMaterial({ color: 0xd8e9e8, roughness: 0.95, flatShading: true }), count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2; const r = 43 + random() * 21; const x = Math.sin(a) * r; const z = Math.cos(a) * r;
      const s = 0.75 + random() * 0.65; const gy = groundHeight(x, z);
      dummy.position.set(x, gy, z); dummy.scale.setScalar(s); dummy.rotation.set(0, random() * 6, 0); dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix); pines.setMatrixAt(i, dummy.matrix); branchSnow.setMatrixAt(i, dummy.matrix);
      this.obstacles.push({ x, z, r: 0.65 * s });
    }
    for (const m of [trunks, pines, branchSnow]) { m.castShadow = true; m.receiveShadow = true; this.group.add(m); }
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.8, 0), new THREE.MeshStandardMaterial({ color: 0x58757b, roughness: 0.95, flatShading: true }), 38);
    for (let i = 0; i < 38; i++) {
      const a = random() * Math.PI * 2; const r = 32 + random() * 32; const s = 0.4 + random() * 1.1;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      dummy.position.set(x, groundHeight(x, z) + s * 0.25, z); dummy.scale.set(s, s * 0.65, s * 0.85); dummy.rotation.set(random(), random() * 6, random()); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
      this.obstacles.push({ x, z, r: 0.72 * s });
    }
    rocks.castShadow = true; rocks.receiveShadow = true; this.group.add(rocks);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x536f77, metalness: 0.5 });
    const flagMat = new THREE.MeshStandardMaterial({ color: COLORS.orange, side: THREE.DoubleSide, roughness: 0.7 });
    for (const [x, z] of [[-27, -27], [27, -27], [-48.6, 33.75], [47.25, 31.05], [-13.5, 52.65], [13.5, -51.3], [-55, -20], [54, 18]] as const) {
      const g = new THREE.Group(); g.position.set(x, groundHeight(x, z), z); this.group.add(g);
      mesh(new THREE.CylinderGeometry(0.045, 0.08, 3.5, 6), poleMat, g, 0, 1.75);
      const flag = mesh(new THREE.PlaneGeometry(1.15, 0.62, 3, 1), flagMat, g, 0.6, 3.05); flag.castShadow = false; this.flags.push(flag);
    }
  }

  private buildCores(): void {
    const coreMat = new THREE.MeshStandardMaterial({ color: 0xe4ece6, emissive: COLORS.cyan, emissiveIntensity: 1.25, metalness: 0.5, roughness: 0.25 });
    const collarMat = new THREE.MeshStandardMaterial({ color: COLORS.orange, metalness: 0.35, roughness: 0.42 });
    const cradleMat = new THREE.MeshStandardMaterial({ color: 0x29434e, roughness: 0.5, metalness: 0.4 });
    const beamMat = new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
    const diamondMat = new THREE.MeshBasicMaterial({ color: COLORS.cyan });
    for (const data of CORE_DATA) {
      const body = new THREE.Group(); body.position.set(data.x, groundHeight(data.x, data.z) + 0.32, data.z); this.group.add(body);
      mesh(new THREE.CylinderGeometry(0.48, 0.55, 0.14, 12), cradleMat, body, 0, -0.22, 0);
      const core = mesh(new THREE.CapsuleGeometry(0.26, 0.46, 4, 10), coreMat, body, 0, 0.08, 0); core.rotation.z = Math.PI / 2;
      for (const x of [-0.38, 0.38]) { const ring = mesh(new THREE.TorusGeometry(0.3, 0.055, 8, 14), collarMat, body, x, 0.08, 0); ring.rotation.y = Math.PI / 2; }
      const marker = new THREE.Group(); marker.position.set(data.x, groundHeight(data.x, data.z), data.z); this.group.add(marker);
      const beam = mesh(new THREE.CylinderGeometry(0.16, 0.75, 7, 12, 1, true), beamMat, marker, 0, 3.5); beam.castShadow = false;
      const diamond = mesh(new THREE.OctahedronGeometry(0.3), diamondMat, marker, 0, 5.1); diamond.castShadow = false;
      body.visible = false; marker.visible = false;
      this.cores.push({ ...data, scanned: false, revealed: false, recovered: false, body, marker, beam: beamMat });
    }
  }

  private buildBackdrop(): void {
    const random = seeded(GAME.seed + 90); const mountains = new THREE.InstancedMesh(new THREE.ConeGeometry(6, 14, 5), new THREE.MeshStandardMaterial({ color: 0x193b49, roughness: 1, flatShading: true }), 32);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 32; i++) {
      const a = i / 32 * Math.PI * 2 + random() * 0.1; const r = 82 + random() * 25; const h = 0.7 + random() * 1.25;
      const sx = 0.8 + random(); const sz = 0.8 + random();
      const x = Math.sin(a) * r; const z = Math.cos(a) * r;
      dummy.position.set(x, 4 * h, z); dummy.scale.set(sx, h, sz); dummy.rotation.y = random() * Math.PI; dummy.updateMatrix(); mountains.setMatrixAt(i, dummy.matrix);
      this.vista.push({ x, z, r: 6 * Math.max(sx, sz) });
    }
    mountains.receiveShadow = true; this.group.add(mountains);
    const starGeo = new THREE.BufferGeometry(); const positions = new Float32Array(420 * 3);
    for (let i = 0; i < 420; i++) { const a = random() * Math.PI * 2; const r = 70 + random() * 55; positions[i * 3] = Math.sin(a) * r; positions[i * 3 + 1] = 22 + random() * 50; positions[i * 3 + 2] = Math.cos(a) * r; }
    starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.group.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xb7d9df, size: 0.15, transparent: true, opacity: 0.7, depthWrite: false })));
  }

  private buildAurora(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(128, 10, 40, 1); const pos = geo.getAttribute("position");
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setZ(i, Math.sin(x * 0.15) * 3); }
    const mat = new THREE.MeshBasicMaterial({ color: 0x56e0bd, transparent: true, opacity: 0.085, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const aurora = new THREE.Mesh(geo, mat); aurora.position.set(0, 29, -88); aurora.rotation.x = -0.12; this.group.add(aurora); return aurora;
  }

  resolveCollision(x: number, z: number, radius: number): { x: number; z: number } {
    x = THREE.MathUtils.clamp(x, -GAME.worldLimit, GAME.worldLimit); z = THREE.MathUtils.clamp(z, -GAME.worldLimit, GAME.worldLimit);
    for (const o of this.obstacles) {
      const dx = x - o.x, dz = z - o.z; const min = o.r + radius; const d = Math.hypot(dx, dz);
      if (d < min) { const inv = d > 0.001 ? 1 / d : 1; x = o.x + dx * inv * min; z = o.z + dz * inv * min; }
    }
    this.collisionResult.x = x; this.collisionResult.z = z; return this.collisionResult;
  }
  updateCores(snow: SnowField): void {
    for (const core of this.cores) if (!core.recovered && core.scanned && !core.revealed && snow.sample(core.x, core.z) < 0.22) { core.revealed = true; core.body.visible = true; }
  }
  recover(core: CoreEntity): void { core.recovered = true; core.body.visible = false; core.marker.visible = false; }
  reset(): void { this.setHeaterSitesVisible(false); for (const core of this.cores) { core.scanned = false; core.revealed = false; core.recovered = false; core.body.visible = false; core.marker.visible = false; } }
  update(time: number, storm = 0): void {
    for (let i = 0; i < this.beaconMaterials.length; i++) this.beaconMaterials[i].emissiveIntensity = 1.55 + Math.sin(time * 2.1 + i) * 0.4;
    for (let i = 0; i < this.flags.length; i++) {
      this.flags[i].rotation.y = Math.sin(time * (2.8 + storm * 8) + i) * (0.14 + storm * 0.42);
      this.flags[i].rotation.z = -storm * 0.28 + Math.sin(time * 9 + i) * storm * 0.08;
    }
    for (let i = 0; i < this.navMarkers.length; i++) {
      const marker = this.navMarkers[i]; marker.position.y = marker.userData.baseY + Math.sin(time * 2.4 + i) * 0.18;
      marker.rotation.y = Math.sin(time * 0.7 + i) * 0.12;
    }
    if (this.objectiveMarker.visible) {
      this.objectiveMarker.rotation.y = time * 0.75;
      this.objectiveMarker.children[1].position.y = 3.5 + Math.sin(time * 3.2) * 0.28;
    }
    if (this.heaterSitesGroup.visible) for (let i = 0; i < this.heaterSiteMarkers.length; i++) {
      const marker = this.heaterSiteMarkers[i]; marker.rotation.y = Math.sin(time * 0.65 + i) * 0.08;
      marker.position.y = marker.userData.baseY + Math.sin(time * 2.4 + i) * 0.06;
    }
    for (const core of this.cores) {
      core.marker.visible = core.revealed && !core.recovered;
      if (core.marker.visible) { core.marker.rotation.y = time * 0.8; core.beam.opacity = 0.12 + Math.sin(time * 3) * 0.05; }
      if (core.revealed && !core.recovered) { core.body.rotation.y = time * 0.65; core.body.position.y = groundHeight(core.x, core.z) + 0.42 + Math.sin(time * 2) * 0.09; }
    }
    this.aurora.position.x = Math.sin(time * 0.06) * 8;
  }
  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>(); const textures = new Set<THREE.Texture>();
    this.group.traverse((o) => { if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite) { geometries.add(o.geometry); const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { materials.add(m); for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value); } } });
    for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); for (const t of textures) t.dispose();
    this.scene.remove(this.group);
  }
}

export { createPlayer, attachEngineer, type PlayerRig } from "./player";
