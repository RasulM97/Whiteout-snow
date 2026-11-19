import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BUILDINGS, type BuildingType, type BuildView, type CargoKind, type PowerForecast, type RobotZoneMode, type SavedBuilding } from "./types";
import { RobotNavigation, type NavPoint } from "./navigation";
import { COLORS, GAME } from "./config";
import { groundHeight, type CircleZone, type SnowField } from "./snow";
import { World, mesh } from "./world";
import { ModelLibrary } from "./models";
import type { PhysicsSystem } from "./physics";
import { MANUAL_RESCUE_COST, ROBOT_RESCUE_COST, type RescueChargeReason } from "./rescue";
import { disposeObject } from "./resources";
import { mats, makeBuildingVisual, createLevelDetails, generatorRadius } from "./building-visuals";
export { generatorRadius } from "./building-visuals";

export interface BuildingEntity {
  id: number; type: BuildingType; x: number; z: number; level: number;
  input: number; output: number; progress: number; powered: boolean;
  group: THREE.Group; ring: THREE.Mesh; status: THREE.MeshStandardMaterial;
  obstacle: CircleZone; robot?: RobotEntity; robots: RobotEntity[]; moving: THREE.Group;
  levelDetails: THREE.Group[];
  activity: number; spawn: number;
  damaged: boolean; powerSource: string; powerLoad: number; powerCapacity: number; powerEfficiency: number;
  cableConnected: boolean; powerWire: THREE.Group | null; damageVisual: THREE.Group;
  statusBadge: THREE.Sprite; alertState: string;
  workArea: { x: number; z: number; radius: number } | null;
}
export interface RobotEntity {
  kind: "sweeper" | "hauler"; slot: number; group: THREE.Group; visual: THREE.Group; motionRig: THREE.Group; frost: THREE.Mesh;
  target: THREE.Vector3 | null; carry: number; returning: boolean; timer: number;
  sourceId: number; destinationId: number; temperature: number; frozen: boolean; thaw: number; rescue: number;
  moving: boolean; working: boolean; district: number; mode: string; health: number;
  energy: number; zoneAuto: boolean; zoneX: number; zoneZ: number; zoneRange: number; assisted: boolean;
  zoneMode: RobotZoneMode; activeChunk: number; chunkIds: number[]; searchRange: number; chunkProgress: number;
  planChunk: number; planLane: number; planDir: number; planCursor: number; planStamp: number; planHold: number; planPass: number; dockWait: number; skipped: number[];
  path: NavPoint[]; pathIndex: number; pathGoal: NavPoint; navVersion: number; repath: number; stuck: number; lastX: number; lastZ: number;
  chunkMarker: THREE.LineLoop;
  repairAllowed: boolean; paymentWait: number; rescuePaid: boolean;
  areaFallback: boolean;
}
export const workAreaRadius = (level: number): number => 16 + Math.max(0, level - 1) * 6;
export const extraSweeperRobotCost = (): number => Math.round(BUILDINGS.sweeper.cost * 0.5);
interface SystemHooks {
  produced: (amount: number) => void;
  power: (amount: number) => void;
  robot: () => void;
  frozen: () => void;
  alert: (b: BuildingEntity, kind: "power" | "input" | "damage") => void;
  repaired: (b: BuildingEntity) => void;
  charge: (cost: number, reason: RescueChargeReason) => boolean;
}



interface SweeperKit {
  cream: THREE.BufferGeometry; orange: THREE.BufferGeometry; rubber: THREE.BufferGeometry;
  dark: THREE.BufferGeometry; cyan: THREE.BufferGeometry;
  brushDark: THREE.BufferGeometry; brushOrange: THREE.BufferGeometry;
  frost: THREE.BufferGeometry; frostMaterial: THREE.MeshBasicMaterial;
}
let sweeperKit: SweeperKit | null = null;

function baked(source: THREE.Mesh): THREE.BufferGeometry {
  const geometry = source.geometry.clone();
  source.updateMatrix();
  geometry.applyMatrix4(source.matrix);
  return geometry;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 1) return parts[0];
  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error("Sweeper geometry merge failed");
  for (const part of parts) part.dispose();
  return geometry;
}

function sharedSweeperKit(): SweeperKit {
  if (sweeperKit) return sweeperKit;
  const visual = new THREE.Group();
  const motionRig = new THREE.Group();
  assembleSweeperSource(visual, motionRig);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const child of visual.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const material = child.material as THREE.Material;
    const list = buckets.get(material) ?? [];
    list.push(baked(child));
    buckets.set(material, list);
  }
  const brush = motionRig.children[0] as THREE.Mesh;
  const darkParts = [brush.geometry.clone()];
  const orangeParts: THREE.BufferGeometry[] = [];
  for (const child of brush.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const geometry = baked(child);
    if (child.material === mats.orange) orangeParts.push(geometry);
    else darkParts.push(geometry);
  }
  sweeperKit = {
    cream: merged(buckets.get(mats.cream)!),
    orange: merged(buckets.get(mats.orange)!),
    rubber: merged(buckets.get(mats.rubber)!),
    dark: merged(buckets.get(mats.dark)!),
    cyan: merged(buckets.get(mats.cyan)!),
    brushDark: merged(darkParts),
    brushOrange: merged(orangeParts),
    frost: new THREE.IcosahedronGeometry(1.05, 1),
    frostMaterial: new THREE.MeshBasicMaterial({ color: 0x9eeeff, transparent: true, opacity: 0.35, wireframe: true, depthWrite: false }),
  };
  visual.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  motionRig.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
  return sweeperKit;
}

function sharedMesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, shadow: boolean): THREE.Mesh {
  const part = new THREE.Mesh(geometry, material);
  part.userData.sharedResources = true;
  part.castShadow = shadow;
  part.receiveShadow = shadow;
  parent.add(part);
  return part;
}

function assembleSweeperSource(visual: THREE.Group, motionRig: THREE.Group): void {
  const body = mesh(new THREE.SphereGeometry(0.5, 14, 10), mats.cream, visual, 0, 0.66, -0.02);
  body.scale.set(1.15, 0.62, 1.2);
  const hood = mesh(new THREE.SphereGeometry(0.46, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), mats.orange, visual, 0, 0.8, 0.02);
  hood.scale.set(1.22, 0.7, 1.22);
  for (const x of [-0.58, 0.58]) {
    const belt = mesh(new THREE.CapsuleGeometry(0.15, 0.98, 3, 8), mats.rubber, visual, x, 0.3, -0.02);
    belt.rotation.x = Math.PI / 2;
    for (const z of [-0.46, 0.46]) {
      const hub = mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.16, 8), mats.dark, visual, x, 0.3, z);
      hub.rotation.z = Math.PI / 2;
      const axle = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6), mats.orange, visual, x, 0.3, z);
      axle.rotation.z = Math.PI / 2;
    }
    for (const z of [-0.2, 0.04, 0.28]) mesh(new THREE.BoxGeometry(0.26, 0.03, 0.045), mats.dark, visual, x, 0.145, z);
  }
  mesh(new THREE.BoxGeometry(0.46, 0.09, 0.04), mats.dark, visual, 0, 0.74, 0.58);
  const status = mesh(new THREE.CapsuleGeometry(0.05, 0.42, 2, 6), mats.cyan, visual, 0, 0.74, 0.64);
  status.rotation.z = Math.PI / 2; status.castShadow = false; status.receiveShadow = false;
  mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.2, 5), mats.dark, visual, 0.02, 1.12, -0.04);
  const tip = mesh(new THREE.SphereGeometry(0.055, 8, 6), mats.cyan, visual, 0.02, 1.25, -0.04);
  tip.castShadow = false; tip.receiveShadow = false;
  for (const x of [-0.64, 0.64]) mesh(new THREE.BoxGeometry(0.06, 0.07, 0.42), mats.dark, visual, x, 0.3, 0.8);
  const brush = mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.24, 8), mats.dark, motionRig, 0, 0.3, 1.04);
  brush.rotation.z = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.08, 14), mats.orange, brush);
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const groove = mesh(new THREE.BoxGeometry(0.025, 1.1, 0.045), mats.dark, brush, Math.cos(angle) * 0.3, 0, Math.sin(angle) * 0.3);
    groove.rotation.y = angle;
  }
  for (const end of [-0.58, 0.58]) mesh(new THREE.SphereGeometry(0.1, 7, 5), mats.dark, brush, 0, end, 0);
}

export class BuildingSystem {
  readonly group = new THREE.Group();
  readonly items: BuildingEntity[] = [];
  private initialObstacles: number;
  private nextId = 1;
  private moveTarget = new THREE.Vector3();
  private zones: CircleZone[] = [];
  private auxiliaryZones: CircleZone[] = [];
  private navigation = new RobotNavigation();
  private relayBoosts = { sweeper: 1, production: 1 };
  private relaySites: Array<{ id: "gale" | "servo" | "foundry"; x: number; z: number; repaired: boolean }> = [];
  private relayLive: Partial<Record<"gale" | "servo" | "foundry", boolean>> = {};
  private time = 0;
  readonly freezeEvents: Array<{ time: number; id: number; slot: number; kind: "sweeper" | "hauler"; x: number; z: number; mode: string; carry: number; returning: boolean; gap: number; storm: number }> = [];
  private currentSnow: SnowField | null = null;
  private retained: Record<CargoKind, number> = { raw: 0, purified: 0, ice: 0 };

  constructor(private scene: THREE.Scene, private world: World, private models: ModelLibrary, private physics: PhysicsSystem, private hooks: SystemHooks) {
    scene.add(this.group); this.initialObstacles = world.obstacles.length;
    this.navigation.rebuild(world.obstacles);
  }

  private statusMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: COLORS.cyan, emissive: COLORS.cyan, emissiveIntensity: 1.8, roughness: 0.3 });
  }

  private refreshLevelDetails(b: BuildingEntity): void {
    for (const detail of b.levelDetails) detail.visible = b.level >= Number(detail.userData.upgradeLevel);
  }

  visualDetails(): Array<{ id: number; type: BuildingType; level: number; visible: number; meshes: number; baseMeshes: number; damageMeshes: number; damageVisible: boolean; alertState: string; badgeVisible: boolean }> {
    return this.items.map((b) => {
      let baseMeshes = 0, damageMeshes = 0;
      for (const child of b.group.children) if (!b.levelDetails.includes(child as THREE.Group)) child.traverse((o) => { if (o instanceof THREE.Mesh) baseMeshes++; });
      b.damageVisual.traverse((object) => { if (object instanceof THREE.Mesh) damageMeshes++; });
      return { id: b.id, type: b.type, level: b.level, visible: b.levelDetails.filter((d) => d.visible).length, meshes: b.levelDetails.reduce((sum, d) => { let count = 0; d.traverse((o) => { if (o instanceof THREE.Mesh) count++; }); return sum + count; }, 0), baseMeshes, damageMeshes, damageVisible: b.damageVisual.visible, alertState: b.alertState, badgeVisible: b.statusBadge.visible };
    });
  }

  createGhost(type: BuildingType): THREE.Group {
    const { group, fallback } = makeBuildingVisual(type, this.statusMaterial());
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const source = Array.isArray(object.material) ? object.material : [object.material];
      const cloned = source.map((material) => { const m = material.clone(); m.transparent = true; m.opacity = 0.32; m.depthWrite = false; return m; });
      object.material = Array.isArray(object.material) ? cloned : cloned[0]; object.castShadow = false; object.receiveShadow = false;
    });
    if (type === "purifier") void this.models.attachGhost(group, "purifier", 3.1, fallback);
    if (type === "press") void this.models.attachGhost(group, "ice-press", 3.15, fallback);
    return group;
  }

  private createStatusBadge(parent: THREE.Group): THREE.Sprite {
    const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 128;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    sprite.position.set(0, 4.35, 0); sprite.scale.set(1.15, 1.15, 1); sprite.visible = false; sprite.renderOrder = 20;
    sprite.userData.canvas = canvas; parent.add(sprite); return sprite;
  }
  private factoryState(b: BuildingEntity): "" | "damage" | "power" | "input" | "output" | "processing" {
    if (b.type !== "purifier" && b.type !== "press") return "";
    if (b.damaged) return "damage";
    if (!b.powered) return "power";
    const full = b.output >= this.outputCapacity(b) - 0.05;
    if (b.type === "purifier") {
      if (full && b.input > 0.05) return "output";
      if (b.input <= 0.05) return "input";
      return "processing";
    }
    if (full && (b.progress > 0 || b.input >= 5)) return "output";
    if (b.progress <= 0 && b.input < 5) return "input";
    return "processing";
  }
  private updateStatusBadge(b: BuildingEntity): void {
    const state = this.factoryState(b);
    // A partial press delivery is not an empty tank. The card can say it is waiting,
    // but the overhead alert stays quiet until the input is actually gone.
    const kind = b.damaged ? "damage" : !b.powered ? "power" : state === "output" ? "output" : state === "input" && b.input < 0.05 ? "input" : "";
    const badge = b.statusBadge; badge.visible = !!kind;
    if (badge.visible) badge.scale.setScalar(1.12 + Math.sin(this.time * 4 + b.id) * 0.08);
    if (kind === b.alertState) return;
    const previous = b.alertState; b.alertState = kind;
    if (!kind) return;
    const canvas = badge.userData.canvas as HTMLCanvasElement; const ctx = canvas.getContext("2d")!; ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = "rgba(9,28,35,.94)"; ctx.strokeStyle = kind === "damage" ? "#ff735c" : kind === "power" ? "#ffd36b" : kind === "output" ? "#ffb15a" : "#86e6ef"; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = ctx.fillStyle = kind === "damage" ? "#ff8a69" : kind === "power" ? "#ffe08a" : kind === "output" ? "#ffc56a" : "#a8f4f4"; ctx.lineWidth = 9; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (kind === "power") {
      ctx.beginPath(); ctx.moveTo(70, 25); ctx.lineTo(43, 67); ctx.lineTo(62, 67); ctx.lineTo(52, 103); ctx.lineTo(87, 55); ctx.lineTo(66, 55); ctx.closePath(); ctx.fill();
    } else if (kind === "output") {
      ctx.strokeRect(36, 44, 56, 42); ctx.fillRect(44, 62, 40, 16);
      ctx.beginPath(); ctx.moveTo(40, 44); ctx.lineTo(64, 28); ctx.lineTo(88, 44); ctx.stroke();
    } else if (kind === "input") {
      for (const [x, y] of [[43, 45], [74, 45], [58, 75]] as const) { ctx.strokeRect(x, y, 24, 24); }
      ctx.beginPath(); ctx.moveTo(38, 104); ctx.lineTo(90, 104); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(40, 91); ctx.lineTo(82, 49); ctx.moveTo(72, 31); ctx.lineTo(92, 51); ctx.moveTo(34, 83); ctx.lineTo(49, 98); ctx.stroke();
      ctx.beginPath(); ctx.arc(84, 39, 15, -0.6, 2.3); ctx.stroke();
    }
    (badge.material as THREE.SpriteMaterial).map!.needsUpdate = true;
    if (kind === "input" || (kind === "power" && previous !== "damage")) this.hooks.alert(b, kind);
  }

  private createPowerWire(b: BuildingEntity): void {
    if (b.powerWire) this.group.remove(b.powerWire);
    if (b.type !== "generator") { b.powerWire = null; return; }
    const wire = new THREE.Group(); wire.name = `power-cable-${b.id}`; this.group.add(wire); b.powerWire = wire;
    const points: THREE.Vector3[] = [];
    const segments = [{ ax: b.x, az: b.z, bx: b.x, bz: GAME.baseCenter.z }, { ax: b.x, az: GAME.baseCenter.z, bx: GAME.baseCenter.x, bz: GAME.baseCenter.z }];
    for (const segment of segments) {
      const length = Math.hypot(segment.bx - segment.ax, segment.bz - segment.az);
      const count = Math.max(2, Math.ceil(length / 1.5));
      for (let i = 0; i <= count; i++) {
        if (points.length && i === 0) continue;
        const t = i / count; const x = THREE.MathUtils.lerp(segment.ax, segment.bx, t); const z = THREE.MathUtils.lerp(segment.az, segment.bz, t);
        points.push(new THREE.Vector3(x, groundHeight(x, z) + 0.13, z));
      }
    }
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
    const cable = mesh(new THREE.TubeGeometry(curve, Math.max(16, points.length * 2), 0.065, 7, false), new THREE.MeshStandardMaterial({ color: 0xe59a51, emissive: 0x7a3c18, emissiveIntensity: 0.25, metalness: 0.45, roughness: 0.48 }), wire);
    cable.name = "ground-power-wire"; cable.castShadow = false;
    for (const point of [points[0], points[points.length - 1]]) mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.18, 10), mats.dark, wire, point.x, point.y, point.z);
  }

  private createDamageVisual(b: BuildingEntity): void {
    const warning = new THREE.Group(); warning.name = "damage-warning"; b.group.add(warning); b.damageVisual = warning;
    const alarm = new THREE.MeshBasicMaterial({ color: 0xff6b55, transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false });
    const scorched = new THREE.MeshStandardMaterial({ color: 0x17252a, roughness: 0.96, metalness: 0.12 });
    const exposed = new THREE.MeshStandardMaterial({ color: 0xffa25f, emissive: 0xb83c18, emissiveIntensity: 0.7, roughness: 0.55 });
    const hazard = mesh(new THREE.TorusGeometry(b.type === "heater" ? 0.95 : 1.65, 0.055, 7, 32), alarm, warning, 0, 0.12); hazard.rotation.x = Math.PI / 2; hazard.castShadow = false;
    const panel = mesh(new THREE.BoxGeometry(b.type === "heater" ? 0.48 : 0.9, 0.1, 0.62), scorched, warning, 0.7, 0.65, -0.45); panel.rotation.set(0.5, 0.25, 0.7);
    const cable = mesh(new THREE.TorusGeometry(0.4, 0.045, 7, 18, Math.PI * 1.45), exposed, warning, -0.45, 0.75, -0.65); cable.rotation.set(0.2, 0.6, -0.4);
    if (b.type === "purifier") {
      const brokenPipe = mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.05, 9), scorched, warning, -1.1, 1.55, 0.3); brokenPipe.rotation.z = 0.85;
      mesh(new THREE.ConeGeometry(0.24, 0.42, 8), exposed, warning, 1.25, 1.9, 0.2).rotation.z = -0.55;
    } else if (b.type === "press") {
      const jam = mesh(new THREE.BoxGeometry(1.2, 0.26, 0.9), scorched, warning, 0.35, 1.5, 0); jam.rotation.z = 0.34;
      mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 8), exposed, warning, -0.9, 0.75, 0.55).rotation.z = 0.6;
    } else if (b.type === "heater") {
      const coil = mesh(new THREE.TorusGeometry(0.55, 0.09, 7, 18, Math.PI * 1.5), scorched, warning, 0.2, 1.65); coil.rotation.set(0.9, 0.3, 0.5);
      mesh(new THREE.ConeGeometry(0.42, 0.7, 8), exposed, warning, 0.5, 0.55).rotation.z = 1.1;
    } else if (b.type === "generator") {
      const vent = mesh(new THREE.BoxGeometry(0.65, 0.16, 1.15), scorched, warning, 0.85, 1.45); vent.rotation.z = 0.75;
      mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.85, 8), exposed, warning, -0.65, 2.1).rotation.z = -0.65;
    } else {
      const canopy = mesh(new THREE.BoxGeometry(1.3, 0.15, 0.85), scorched, warning, 0.65, 1.75, 0.4); canopy.rotation.set(0.25, 0.2, 0.55);
      const arm = mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.1, 8), exposed, warning, -0.8, 1.2, 0.5); arm.rotation.z = -0.9;
    }
    const smoke = new THREE.Group(); smoke.name = "damage-smoke"; warning.add(smoke);
    for (let i = 0; i < 4; i++) {
      const puff = mesh(new THREE.IcosahedronGeometry(0.18 + i * 0.045, 1), new THREE.MeshBasicMaterial({ color: 0x26383d, transparent: true, opacity: 0.34 - i * 0.045, depthWrite: false }), smoke, Math.sin(i * 2.1) * 0.25, 1.7 + i * 0.4, Math.cos(i * 1.7) * 0.2);
      puff.castShadow = false; puff.userData.smokeIndex = i;
    }
    const beacon = new THREE.Group(); beacon.name = "damage-beacon"; beacon.position.y = b.type === "heater" ? 3.35 : 3.7; warning.add(beacon);
    mesh(new THREE.OctahedronGeometry(0.27), alarm, beacon).castShadow = false;
    const ring = mesh(new THREE.TorusGeometry(0.46, 0.045, 6, 20), alarm, beacon); ring.castShadow = false;
    const bolt = mesh(new THREE.BoxGeometry(0.09, 0.34, 0.09), new THREE.MeshBasicMaterial({ color: 0xfff0cf, toneMapped: false }), beacon, 0, 0.02, 0.22); bolt.castShadow = false;
    mesh(new THREE.SphereGeometry(0.055, 7, 5), bolt.material as THREE.Material, beacon, 0, -0.22, 0.22).castShadow = false;
    warning.visible = false;
  }

  build(type: BuildingType, x: number, z: number, charge: (cost: number) => boolean, restored = false): BuildingEntity | null {
    const def = BUILDINGS[type];
    if (type === "generator" && !this.generatorReaches(x, z)) return null;
    if (!restored && !charge(def.cost)) return null;
    const status = this.statusMaterial(); const { group, ring, fallback, moving } = makeBuildingVisual(type, status);
    group.position.set(x, groundHeight(x, z) + 0.04, z); group.scale.setScalar(0.01); this.group.add(group);
    const obstacle = { x, z, r: def.radius }; this.world.obstacles.push(obstacle); this.physics.addCircle(obstacle);
    const b: BuildingEntity = {
      id: this.nextId++, type, x, z, level: 1, input: 0, output: 0, progress: 0,
      powered: type !== "generator", group, ring, status, obstacle, robots: [], moving,
      levelDetails: [], activity: restored ? 0 : 1, spawn: restored ? 1 : 0,
      damaged: false, powerSource: "none", powerLoad: 0, powerCapacity: 0,
      powerEfficiency: 0, cableConnected: type !== "generator", powerWire: null,
      damageVisual: new THREE.Group(), statusBadge: this.createStatusBadge(group), alertState: "",
      workArea: null,
    };
    this.createDamageVisual(b); this.createPowerWire(b); createLevelDetails(b); this.items.push(b);
    if (type === "purifier") void this.models.attach(group, "purifier", 3.1, fallback).then((placed) => { if (placed) moving.visible = false; });
    if (type === "press") void this.models.attach(group, "ice-press", 3.15, fallback).then((placed) => { if (placed) moving.visible = false; });
    if (type === "sweeper" || type === "hauler") { this.spawnRobot(b); if (!restored) this.hooks.robot(); }
    this.refreshPowerGrid(); this.refreshHeaterZones(); this.navigation.rebuild(this.world.obstacles);
    return b;
  }

  private spawnRobot(b: BuildingEntity, slot = b.robots.length): RobotEntity {
    const group = new THREE.Group(); const visual = new THREE.Group(); const motionRig = new THREE.Group(); group.add(visual, motionRig); this.group.add(group);
    const kind = b.type as "sweeper" | "hauler";
    if (kind === "sweeper") this.buildSweeper(visual, motionRig);
    else {
      // New search-and-rescue unit: a forward-facing aerial medic/welder, not the old cargo rover.
      const body = mesh(new THREE.SphereGeometry(0.58, 16, 12), mats.cream, visual, 0, 1.02, 0.04); body.scale.set(0.82, 0.56, 1.22);
      const visor = mesh(new THREE.SphereGeometry(0.26, 12, 8), mats.cyan, visual, 0, 1.05, 0.68); visor.scale.set(1.25, 0.42, 0.38);
      mesh(new THREE.SphereGeometry(0.14, 10, 8), mats.orange, visual, 0, 0.7, 0.28);
      for (const side of [-1, 1] as const) {
        const arm = mesh(new THREE.CapsuleGeometry(0.065, 0.62, 3, 6), mats.dark, visual, side * 0.62, 1.08, 0); arm.rotation.z = side * Math.PI / 2;
        for (const z of [-0.42, 0.42]) {
          mesh(new THREE.SphereGeometry(0.09, 8, 6), mats.dark, visual, side * 0.98, 1.08, z);
          const blade = mesh(new THREE.BoxGeometry(0.5, 0.028, 0.06), mats.cyan, motionRig, side * 0.98, 1.16, z); blade.userData.rotor = true;
        }
      }
      const welder = mesh(new THREE.CapsuleGeometry(0.045, 0.36, 2, 6), mats.orange, motionRig, 0, 0.58, 0.66); welder.rotation.x = -0.4; welder.userData.welder = true;
      mesh(new THREE.SphereGeometry(0.06, 8, 6), mats.cyan, welder, 0, -0.24, 0);
    }
    const sweeperParts = kind === "sweeper" ? sharedSweeperKit() : null;
    const frost = mesh(sweeperParts ? sweeperParts.frost : new THREE.IcosahedronGeometry(1.05, 1), sweeperParts ? sweeperParts.frostMaterial : new THREE.MeshBasicMaterial({ color: 0x9eeeff, transparent: true, opacity: 0.35, wireframe: true, depthWrite: false }), group, 0, 0.85);
    if (sweeperParts) frost.userData.sharedResources = true;
    frost.scale.set(1, 0.9, 1.15); frost.visible = false; frost.castShadow = false;
    group.position.set(b.x + 2 + slot * 0.7, groundHeight(b.x + 2 + slot * 0.7, b.z) + 0.06, b.z + slot * 0.65);
    if (kind === "sweeper") void this.models.attach(visual, "sweeper-bot", 1.5).then((placed) => {
      if (placed) { for (const child of visual.children) if (child !== placed) child.visible = false; for (const child of motionRig.children) child.visible = false; }
    });
    const markerMaterial = new THREE.LineBasicMaterial({ color: kind === "hauler" ? 0xffb45d : 0x65e4df, transparent: true, opacity: 0.8, depthTest: false });
    const chunkMarker = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 4 }, () => new THREE.Vector3())), markerMaterial);
    chunkMarker.visible = false; chunkMarker.renderOrder = 8; this.group.add(chunkMarker);
    const robot: RobotEntity = {
      kind, slot, group, visual, motionRig, frost, target: null, carry: 0, returning: false, timer: 0,
      sourceId: 0, destinationId: 0, temperature: 100, frozen: false, thaw: 0, rescue: 0,
      moving: false, working: false, district: slot * 2, mode: kind === "hauler" ? "patrol" : "seek", health: 100,
      energy: 100, zoneAuto: true, zoneX: b.x, zoneZ: b.z, zoneRange: 12 + b.level * 4, assisted: false,
      zoneMode: "auto", activeChunk: -1, chunkIds: [], searchRange: 12 + b.level * 4, chunkProgress: 0,
      planChunk: -1, planLane: 0, planDir: 1, planCursor: 0, planStamp: -1, planHold: 0, planPass: 0, dockWait: 0, skipped: [],
      path: [], pathIndex: 0, pathGoal: { x: Number.NaN, z: Number.NaN }, navVersion: this.navigation.version,
      repath: 0, stuck: 0, lastX: group.position.x, lastZ: group.position.z, chunkMarker,
      repairAllowed: true, paymentWait: 0, rescuePaid: false, areaFallback: false,
    };
    if (b.workArea && kind === "sweeper") this.applyArea(b, robot);
    b.robots.push(robot); if (!b.robot) b.robot = robot; return robot;
  }

  private buildSweeper(visual: THREE.Group, motionRig: THREE.Group): void {
    const kit = sharedSweeperKit();
    sharedMesh(kit.cream, mats.cream, visual, true);
    sharedMesh(kit.orange, mats.orange, visual, true);
    sharedMesh(kit.rubber, mats.rubber, visual, true);
    sharedMesh(kit.dark, mats.dark, visual, true);
    sharedMesh(kit.cyan, mats.cyan, visual, false);
    const brush = sharedMesh(kit.brushDark, mats.dark, motionRig, true);
    brush.position.set(0, 0.3, 1.04);
    brush.rotation.z = Math.PI / 2;
    sharedMesh(kit.brushOrange, mats.orange, brush, true);
  }

  buyExtraRobot(id: number, charge: (cost: number) => boolean): boolean {
    const b = this.byId(id); if (!b || b.type !== "sweeper" || b.damaged || b.robots.length >= b.level) return false;
    if (!charge(extraSweeperRobotCost())) return false;
    this.spawnRobot(b); this.hooks.robot(); return true;
  }

  setRobotZone(id: number, slot: number, auto: boolean, x?: number, z?: number, range?: number): boolean {
    return this.setRobotZoneMode(id, slot, auto ? "auto" : "custom", x, z, range);
  }
  setRobotZoneMode(id: number, slot: number, mode: RobotZoneMode, x?: number, z?: number, range?: number): boolean {
    const b = this.byId(id); const r = b?.robots.find((robot) => robot.slot === slot);
    if (!b || !r || b.type !== "sweeper") return false;
    r.zoneMode = mode; r.zoneAuto = mode === "auto"; r.target = null; r.timer = 0; r.activeChunk = -1; r.chunkIds = [];
    r.planChunk = -1; r.planHold = 0;
    r.searchRange = 12 + b.level * 4; r.path = []; r.navVersion = -1;
    if (mode === "custom") {
      if (Number.isFinite(x)) r.zoneX = THREE.MathUtils.clamp(x!, -GAME.worldLimit, GAME.worldLimit);
      if (Number.isFinite(z)) r.zoneZ = THREE.MathUtils.clamp(z!, -GAME.worldLimit, GAME.worldLimit);
    } else if (mode === "auto" || mode === "shelter" || mode === "supply") { r.zoneX = b.x; r.zoneZ = b.z; }
    if (mode === "supply") r.searchRange = Math.min(r.searchRange, 22 + b.level * 6);
    if (Number.isFinite(range)) r.searchRange = THREE.MathUtils.clamp(range!, 8, GAME.worldSize);
    r.zoneRange = r.searchRange; r.areaFallback = false;
    if (mode !== "area" && b.workArea && b.robots.every((robot) => robot.zoneMode !== "area")) b.workArea = null;
    return true;
  }
  assignWorkArea(id: number, x: number, z: number): { ok: boolean; radius: number; robots: number } {
    const b = this.byId(id);
    if (!b || b.type !== "sweeper" || b.damaged) return { ok: false, radius: 0, robots: 0 };
    const radius = workAreaRadius(b.level);
    const center = { x: THREE.MathUtils.clamp(x, -GAME.worldLimit, GAME.worldLimit), z: THREE.MathUtils.clamp(z, -GAME.worldLimit, GAME.worldLimit) };
    b.workArea = { ...center, radius };
    let robots = 0;
    for (const robot of b.robots) if (robot.kind === "sweeper") { this.applyArea(b, robot); robots++; }
    return { ok: robots > 0, radius, robots };
  }
  clearWorkArea(id: number): boolean {
    const b = this.byId(id); if (!b || b.type !== "sweeper") return false;
    b.workArea = null;
    for (const robot of b.robots) if (robot.kind === "sweeper") this.setRobotZoneMode(id, robot.slot, "auto");
    return true;
  }
  private applyArea(b: BuildingEntity, robot: RobotEntity): void {
    const area = b.workArea; if (!area) return;
    robot.zoneMode = "area"; robot.zoneAuto = false; robot.areaFallback = false;
    robot.zoneX = area.x; robot.zoneZ = area.z; robot.zoneRange = area.radius; robot.searchRange = area.radius;
    robot.target = null; robot.activeChunk = -1; robot.chunkIds = []; robot.planChunk = -1; robot.path = []; robot.navVersion = -1;
  }
  chunkQuota(b: BuildingEntity): number { return b.type === "sweeper" ? 1 + b.level : 0; }

  private moveRobot(r: RobotEntity, target: THREE.Vector3, speed: number, dt: number): number {
    const p = r.group.position; const goal = { x: target.x, z: target.z };
    const finalDistance = Math.hypot(goal.x - p.x, goal.z - p.z); r.repath -= dt;
    const goalChanged = !Number.isFinite(r.pathGoal.x) || Math.hypot(goal.x - r.pathGoal.x, goal.z - r.pathGoal.z) > 1.1;
    if (goalChanged || r.navVersion !== this.navigation.version || (r.pathIndex >= r.path.length && finalDistance > 1.4 && r.repath <= 0) || (r.stuck > 0.38 && r.repath <= 0)) {
      r.path = this.navigation.findPath(p, goal); r.pathIndex = 0; r.pathGoal = goal; r.navVersion = this.navigation.version; r.repath = 0.8; r.stuck = 0;
    }
    while (r.pathIndex < r.path.length && Math.hypot(r.path[r.pathIndex].x - p.x, r.path[r.pathIndex].z - p.z) < 0.42) r.pathIndex++;
    const waypoint = r.path[r.pathIndex] ?? goal; const dx = waypoint.x - p.x, dz = waypoint.z - p.z; const d = Math.hypot(dx, dz);
    r.moving = d > 0.08 && !r.frozen && finalDistance > 0.12;
    if (r.moving) {
      const oldX = p.x, oldZ = p.z; const step = Math.min(d, speed * dt); const next = this.world.resolveCollision(p.x + dx / d * step, p.z + dz / d * step, 0.52);
      p.x = next.x; p.z = next.z; p.y = this.currentSnow?.heightAt(p.x, p.z) ?? groundHeight(p.x, p.z) + 0.06;
      const moved = Math.hypot(p.x - oldX, p.z - oldZ);
      if (moved < step * 0.12) r.stuck += dt; else r.stuck = Math.max(0, r.stuck - dt * 2);
      if (moved > 0.0001) {
        const yaw = Math.atan2(p.x - oldX, p.z - oldZ); const current = r.group.rotation.y;
        r.group.rotation.y = current + Math.atan2(Math.sin(yaw - current), Math.cos(yaw - current)) * Math.min(1, dt * 9);
      }
    }
    r.lastX = p.x; r.lastZ = p.z; return finalDistance;
  }

  private updateChunkMarker(r: RobotEntity, snow: SnowField): void {
    r.chunkMarker.visible = r.kind === "sweeper" && r.activeChunk >= 0;
    if (!r.chunkMarker.visible) return;
    const c = snow.chunkCenter(r.activeChunk); const h = snow.chunkSize * 0.49;
    const points = [[-h, -h], [h, -h], [h, h], [-h, h]] as const;
    const attribute = r.chunkMarker.geometry.getAttribute("position") as THREE.BufferAttribute;
    points.forEach(([x, z], i) => attribute.setXYZ(i, c.x + x, groundHeight(c.x + x, c.z + z) + 0.24, c.z + z));
    attribute.needsUpdate = true; r.chunkMarker.geometry.computeBoundingSphere();
  }

  private areaContains(r: RobotEntity, snow: SnowField, id: number): boolean {
    const center = snow.chunkCenter(id);
    return Math.hypot(center.x - r.zoneX, center.z - r.zoneZ) <= r.zoneRange + snow.chunkSize * 0.35;
  }
  private chooseChunk(x: number, z: number, b: BuildingEntity, r: RobotEntity, snow: SnowField, avoid: number[], fromX: number, fromZ: number): number | null {
    const slack = snow.chunkSize * 0.42;
    const ordered = r.zoneMode === "area" && !r.areaFallback;
    const accept = r.zoneMode === "shelter" ? (id: number) => {
      const center = snow.chunkCenter(id); return this.warmed(center.x, center.z, slack);
    } : ordered ? (id: number) => this.areaContains(r, snow, id) : undefined;
    const near = r.zoneMode === "supply" || ordered;
    const mates = b.robots.filter((robot) => robot.kind === "sweeper" && robot.zoneMode === "area");
    const index = Math.max(0, mates.indexOf(r));
    const angle = (index / Math.max(1, mates.length)) * Math.PI * 2;
    const biasX = ordered ? r.zoneX + Math.cos(angle) * r.zoneRange * 0.55 : fromX;
    const biasZ = ordered ? r.zoneZ + Math.sin(angle) * r.zoneRange * 0.55 : fromZ;
    return snow.findBestChunk(x, z, ordered ? r.zoneRange : r.searchRange, avoid, near && !ordered ? b.x : biasX, near && !ordered ? b.z : biasZ, accept, near);
  }

  private findSweeperTarget(b: BuildingEntity, r: RobotEntity, snow: SnowField): THREE.Vector3 | null {
    if (r.zoneMode === "area") {
      const fresh = snow.findBestChunk(r.zoneX, r.zoneZ, r.zoneRange, [], r.zoneX, r.zoneZ, (id) => this.areaContains(r, snow, id), true);
      r.areaFallback = fresh === null;
      if (!r.areaFallback) { r.searchRange = r.zoneRange; r.zoneRange = b.workArea?.radius ?? r.zoneRange; }
    }
    if (r.zoneMode === "supply") { const cap = 22 + b.level * 6; if (r.searchRange > cap) { r.searchRange = cap; r.zoneRange = cap; } }
    if (r.zoneMode === "shelter") {
      const slack = snow.chunkSize * 0.42;
      const warmChunk = (id: number) => { const center = snow.chunkCenter(id); return this.warmed(center.x, center.z, slack); };
      r.chunkIds = r.chunkIds.filter(warmChunk);
      if (r.activeChunk >= 0 && !warmChunk(r.activeChunk)) { r.activeChunk = -1; r.planChunk = -1; }
    }
    const ordered = r.zoneMode === "area" && !r.areaFallback;
    const x = r.zoneMode === "auto" || r.areaFallback ? b.x : r.zoneX; const z = r.zoneMode === "auto" || r.areaFallback ? b.z : r.zoneZ;
    // Storm dust must not pin the search on the dock. An assigned circle does not grow past its radius.
    if (!ordered && r.zoneMode !== "supply" && r.zoneMode !== "shelter" && r.searchRange < GAME.worldSize && !snow.hasFreshChunk(x, z, r.searchRange)) {
      r.searchRange = Math.min(GAME.worldSize, r.searchRange + snow.chunkSize); r.zoneRange = r.searchRange;
    }
    const reserved = new Set<number>();
    for (const building of this.items) for (const other of building.robots) if (other !== r && other.kind === "sweeper") {
      if (other.activeChunk >= 0) reserved.add(other.activeChunk); for (const id of other.chunkIds) reserved.add(id);
    }
    if (r.activeChunk >= 0 && snow.chunkView(r.activeChunk).remaining < 0.55) {
      r.chunkIds = r.chunkIds.filter((id) => id !== r.activeChunk); r.activeChunk = -1;
    }
    r.chunkIds = r.chunkIds.filter((id) => snow.chunkView(id).remaining >= 0.55 && !r.skipped.includes(id));
    const quota = this.chunkQuota(b);
    const avoid = () => [...reserved, ...r.chunkIds, ...r.skipped];
    while (r.chunkIds.length < quota) {
      const fromX = r.activeChunk >= 0 ? snow.chunkCenter(r.activeChunk).x : r.group.position.x;
      const fromZ = r.activeChunk >= 0 ? snow.chunkCenter(r.activeChunk).z : r.group.position.z;
      const found = this.chooseChunk(x, z, b, r, snow, avoid(), fromX, fromZ);
      if (found === null) {
        if (ordered && r.chunkIds.length === 0) {
          const shared = snow.findBestChunk(x, z, r.zoneRange, [...r.skipped], r.group.position.x, r.group.position.z, (id) => this.areaContains(r, snow, id), true);
          if (shared !== null) { r.chunkIds.push(shared); reserved.add(shared); continue; }
        }
        if (!ordered && r.zoneMode !== "supply" && r.searchRange < GAME.worldSize) { r.searchRange = Math.min(GAME.worldSize, r.searchRange + snow.chunkSize); r.zoneRange = r.searchRange; continue; }
        // The score floor ignores storm dust so the search can keep expanding.
        // Once the map is in range, that same dust is the work that finishes the cleanup.
        const mop = r.zoneMode === "supply" || ordered ? null : snow.findBestChunk(x, z, r.searchRange, avoid(), fromX, fromZ, r.zoneMode === "shelter" ? (id) => { const center = snow.chunkCenter(id); return this.warmed(center.x, center.z, snow.chunkSize * 0.42); } : undefined, true);
        if (mop !== null) { r.chunkIds.push(mop); reserved.add(mop); continue; }
        break;
      }
      r.chunkIds.push(found); reserved.add(found);
    }
    const nearestQueued = () => {
      const fresh = r.chunkIds.filter((id) => snow.chunkView(id).progress < 0.45);
      const pool = fresh.length ? fresh : r.chunkIds;
      return [...pool].sort((a, c) => {
        const ca = snow.chunkCenter(a), cc = snow.chunkCenter(c);
        return Math.hypot(ca.x - r.group.position.x, ca.z - r.group.position.z) - Math.hypot(cc.x - r.group.position.x, cc.z - r.group.position.z);
      })[0] ?? -1;
    };
    // A blocked or already-clear lane used to pin the queue on one dead chunk.
    // Drop it, remember it briefly, and try the next queued patch in the same search.
    for (let attempt = 0; attempt < 8; attempt++) {
      const activeIsDust = r.activeChunk >= 0 && snow.chunkView(r.activeChunk).progress >= 0.45 && r.chunkIds.some((id) => id !== r.activeChunk && snow.chunkView(id).progress < 0.45);
      if (r.activeChunk < 0 || !r.chunkIds.includes(r.activeChunk) || r.skipped.includes(r.activeChunk) || activeIsDust) r.activeChunk = nearestQueued();
      r.chunkProgress = r.activeChunk >= 0 ? snow.chunkView(r.activeChunk).progress : 0;
      this.updateChunkMarker(r, snow);
      if (r.planHold > 0 || r.activeChunk < 0) return null;
      const point = this.coveragePoint(b, r, snow);
      if (point) return point;
      if (!r.skipped.includes(r.activeChunk)) r.skipped.push(r.activeChunk);
      if (r.skipped.length > 16) r.skipped.shift();
      const failed = r.activeChunk;
      r.chunkIds = r.chunkIds.filter((id) => id !== failed); r.activeChunk = -1; r.planChunk = -1;
      const fromX = r.group.position.x; const fromZ = r.group.position.z;
      const replacement = this.chooseChunk(x, z, b, r, snow, avoid(), fromX, fromZ);
      if (replacement !== null) { r.chunkIds.push(replacement); reserved.add(replacement); r.activeChunk = replacement; }
    }
    return null;
  }

  /** Sweepers sharing a chunk take interleaved lanes so their passes do not stack. */
  private laneShare(chunk: number, self: RobotEntity): { index: number; count: number } {
    const keys: string[] = []; let mine = "";
    for (const building of this.items) for (const other of building.robots) {
      if (other.kind !== "sweeper" || (other.activeChunk !== chunk && !other.chunkIds.includes(chunk))) continue;
      const key = `${building.id}:${other.slot}`; keys.push(key); if (other === self) mine = key;
    }
    keys.sort();
    return { index: Math.max(0, keys.indexOf(mine)), count: Math.max(1, keys.length) };
  }

  /**
   * Alternating lanes across the assigned chunk. The cursor survives docking,
   * a thermal retreat and a freeze. A storm rewinds the current lane instead of
   * picking a new high-score cell.
   */
  private coveragePoint(b: BuildingEntity, r: RobotEntity, snow: SnowField): THREE.Vector3 | null {
    const chunk = r.activeChunk; if (chunk < 0) return null;
    const spacing = (1.4 + b.level * 0.22) * 1.65;
    const center = snow.chunkCenter(chunk); const half = snow.chunkSize / 2;
    const lanes = Math.max(3, Math.ceil(snow.chunkSize / spacing));
    const share = this.laneShare(chunk, r);
    const margin = spacing * 0.45;
    const minX = center.x - half + margin; const maxX = center.x + half - margin;
    const owned = (lane: number) => lane % share.count === share.index;
    const enter = (lane: number) => {
      const ordinal = Math.floor((lane - share.index) / share.count);
      r.planLane = lane; r.planDir = ordinal % 2 === 0 ? 1 : -1; r.planCursor = r.planDir > 0 ? minX : maxX;
    };
    if (r.planChunk !== chunk || !owned(r.planLane) || r.planLane >= lanes) {
      r.planChunk = chunk; r.planStamp = snow.revision; r.planPass = 0; enter(share.index);
    } else if (snow.revision !== r.planStamp) {
      r.planStamp = snow.revision;
      // A first pass still rewinds onto the same lane. A chunk that has already
      // been swept is storm dust; holding it pins the fleet and leaves the
      // untouched districts standing. Drop it so the frontier search can move on.
      if (snow.chunkView(chunk).progress >= 0.45) return null;
      r.planCursor = r.planDir > 0 ? minX : maxX;
    }
    const step = 0.9;
    for (let guard = 0; guard < lanes * 2 + 2; guard++) {
      const laneZ = center.z - half + (r.planLane + 0.5) * (snow.chunkSize / lanes);
      let hops = 0;
      while (hops++ < 24) {
        const past = r.planDir > 0 ? r.planCursor > maxX : r.planCursor < minX;
        if (past) break;
        const clear = snow.sample(r.planCursor, laneZ) < 0.08 || this.navigation.blocked(r.planCursor, laneZ);
        if (!clear) return new THREE.Vector3(r.planCursor, 0, laneZ);
        r.planCursor += step * r.planDir;
      }
      let next = r.planLane + 1; let turns = 0;
      while (turns++ <= lanes && (next >= lanes || !owned(next))) next = next >= lanes ? 0 : next + 1;
      if (next === share.index || turns > lanes) {
        const remaining = snow.chunkView(chunk).remaining;
        if (remaining >= 0.55 && r.planPass < 1) {
          r.planPass = 1; enter(share.index); r.planCursor += 0.45 * r.planDir; continue;
        }
        const speck = this.speckPoint(r, snow, chunk);
        if (speck) return speck;
        // Owned lanes are finished. Leave the chunk instead of idling on it.
        r.planPass = 0; r.planHold = 0; r.planChunk = -2; return null;
      }
      enter(next);
    }
    const speck = this.speckPoint(r, snow, chunk);
    if (speck) return speck;
    r.planPass = 0; r.planHold = 0; r.planChunk = -2; return null;
  }

  /** Lane sweeps miss storm specks that sit between the lanes. Walk to the cell itself. */
  private speckPoint(r: RobotEntity, snow: SnowField, chunk: number): THREE.Vector3 | null {
    if (snow.chunkView(chunk).remaining < 0.55) return null;
    const speck = snow.findChunkTarget(chunk, r.group.position.x, r.group.position.z, (x, z) => this.navigation.blocked(x, z));
    return speck ? new THREE.Vector3(speck.x, 0, speck.z) : null;
  }

  routeExists(from: { x: number; z: number }, to: { x: number; z: number }): boolean {
    if (Math.hypot(from.x - to.x, from.z - to.z) < 2.2) return true;
    return this.navigation.findPath(from, to).length > 0;
  }

  warmed(x: number, z: number, slack = 0): boolean {
    if (Math.hypot(x - GAME.baseCenter.x, z - GAME.baseCenter.z) < GAME.baseHeatRadius + slack) return true;
    for (const heater of this.items) if (heater.type === "heater" && heater.powered && !heater.damaged) {
      if (Math.hypot(x - heater.x, z - heater.z) < 7 + (heater.level - 1) * 2 + slack) return true;
    }
    for (const zone of this.auxiliaryZones) if (Math.hypot(x - zone.x, z - zone.z) < zone.r + slack) return true;
    return false;
  }
  private sweeperHeatAt(x: number, z: number): boolean { return this.warmed(x, z); }
  /** Sweepers still assigned to cold ground when a storm is about to start. */
  exposedSweeperCount(): number {
    let count = 0;
    for (const building of this.items) if (building.type === "sweeper" && !building.damaged) for (const robot of building.robots) {
      if (robot.frozen || robot.zoneMode === "shelter") continue;
      if (!this.warmed(robot.group.position.x, robot.group.position.z)) count++;
    }
    return count;
  }

  /** A heat point the sweeper can walk to before it reaches 0°. Relays are not shelters. */
  private sweeperRetreatTarget(b: BuildingEntity, r: RobotEntity, storm: number, committed = false): { x: number; z: number } | null {
    const drain = 0.62 + storm * 1.35;
    const speed = (5.8 + b.level * 0.95) * Math.max(0.55, b.powerEfficiency) * this.relayBoosts.sweeper * (r.temperature < 30 ? 0.72 : 1);
    const reach = speed * (Math.max(0, r.temperature) / Math.max(0.05, drain)) * 0.8;
    const origin = { x: r.group.position.x, z: r.group.position.z };
    const zones: Array<{ x: number; z: number; r: number }> = [{ x: GAME.baseCenter.x, z: GAME.baseCenter.z, r: GAME.baseHeatRadius }];
    for (const heater of this.items) if (heater.type === "heater" && heater.powered && !heater.damaged) zones.push({ x: heater.x, z: heater.z, r: 7 + (heater.level - 1) * 2 });
    let best: { x: number; z: number; gap: number } | null = null;
    for (const zone of zones) {
      const centerDistance = Math.hypot(origin.x - zone.x, origin.z - zone.z);
      const inset = Math.max(0.8, zone.r - 1.2);
      const gap = Math.max(0, centerDistance - inset);
      // A retreat already underway keeps its shelter. Re-checking the colder
      // storm budget used to cancel the walk and send the sweeper back outside.
      if (!committed && gap > reach) continue;
      const target = gap <= 0.2 || centerDistance < 0.001 ? origin : {
        x: zone.x + (origin.x - zone.x) / centerDistance * inset,
        z: zone.z + (origin.z - zone.z) / centerDistance * inset,
      };
      if (gap > 1.2 && !this.routeExists(origin, target)) continue;
      if (!best || gap < best.gap) best = { x: target.x, z: target.z, gap };
    }
    return best ? { x: best.x, z: best.z } : null;
  }

  /**
   * Below 30° a working sweeper walks to base heat or a powered heater.
   * It leaves again at 62° only while the weather is calm. Cargo and the
   * dock-return flag are kept. Frozen units stay on the paid rescue path.
   */
  private directSweeperHeat(b: BuildingEntity, r: RobotEntity, dt: number, storm: number): boolean {
    if (r.frozen || r.health <= 0) return false;
    const heatHere = this.sweeperHeatAt(r.group.position.x, r.group.position.z);
    const retreating = r.mode === "warm-return" || r.mode === "recharge";
    // Calm intensity falls to 0. The 12s warning holds near 0.16 and the storm
    // climbs from there. A sweeper that has already reached heat stays through
    // that window instead of leaving at 62° and meeting the storm outside.
    if (retreating && heatHere && storm >= 0.1) {
      r.mode = "recharge"; r.target = null; r.moving = false; r.working = false;
      return true;
    }
    if (retreating && r.temperature >= 62 && heatHere) {
      r.mode = r.returning ? "return" : "seek"; r.target = null; r.moving = false; r.working = false;
      return false;
    }
    if (!retreating && (r.temperature >= 30 || heatHere)) return false;
    const shelter = this.sweeperRetreatTarget(b, r, storm, retreating);
    if (!shelter) {
      if (retreating) { r.mode = "warm-return"; r.target = null; r.moving = false; r.working = false; return true; }
      return false;
    }
    const efficiency = Math.max(0.55, b.powerEfficiency);
    const speed = (5.8 + b.level * 0.95) * efficiency * this.relayBoosts.sweeper * (r.temperature < 30 ? 0.72 : 1);
    r.working = false; r.target = null;
    this.moveTarget.set(shelter.x, 0, shelter.z);
    this.moveRobot(r, this.moveTarget, speed, dt);
    const arrived = this.sweeperHeatAt(r.group.position.x, r.group.position.z);
    r.mode = arrived ? "recharge" : "warm-return";
    if (arrived) r.moving = false;
    return true;
  }

  private updateSweeper(b: BuildingEntity, r: RobotEntity, snow: SnowField, dt: number, storm: number, player?: { x: number; z: number }): void {
    if (this.directSweeperHeat(b, r, dt, storm)) return;
    if (r.zoneMode === "follow" && player) { r.zoneX = player.x; r.zoneZ = player.z; }
    const efficiency = Math.max(0.55, b.powerEfficiency);
    const speed = (5.8 + b.level * 0.95) * efficiency * this.relayBoosts.sweeper * (r.temperature < 30 ? 0.72 : 1);
    const capacity = 20 + b.level * 6;
    r.timer -= dt; r.working = false; r.planHold = Math.max(0, r.planHold - dt); r.dockWait = Math.max(0, r.dockWait - dt);
    if (r.stuck > 0.55 && r.target && r.planChunk === r.activeChunk) {
      r.planCursor += (1.4 + b.level * 0.22) * 1.32 * (r.planDir || 1); r.target = null; r.stuck = 0; r.path = [];
    }
    if (r.returning) {
      r.mode = "return";
      this.moveTarget.set(b.x + 2.25, 0, b.z);
      if (this.moveRobot(r, this.moveTarget, speed, dt) < 2.15) {
        r.mode = "unload";
        const accepted = Math.min(r.carry, Math.max(0, this.outputCapacity(b) - b.output));
        b.output += accepted; r.carry -= accepted; r.working = accepted > 0; b.activity = Math.max(b.activity, 0.8);
        if (r.carry <= 0.01) { r.carry = 0; r.returning = false; r.dockWait = 0; r.target = null; r.timer = 0; r.mode = "seek"; r.working = false; }
        else { r.returning = false; r.dockWait = 10; r.target = null; r.mode = "seek"; }
      }
      return;
    }
    if ((!r.target || snow.sample(r.target.x, r.target.z) < 0.08) && r.planHold <= 0) {
      r.mode = "seek"; r.target = this.findSweeperTarget(b, r, snow); r.timer = 0.55;
    }
    if (!r.target) {
      if (r.planHold > 0) { r.mode = "wait"; r.moving = false; r.working = false; return; }
      r.mode = r.searchRange < GAME.worldSize ? "expand" : "wait"; r.moving = false;
      this.moveTarget.set(b.x + 2 + r.slot * 0.7, 0, b.z + r.slot * 0.65);
      if (Math.hypot(r.group.position.x - b.x, r.group.position.z - b.z) > 4) this.moveRobot(r, this.moveTarget, speed, dt);
      return;
    }
    const distance = this.moveRobot(r, r.target, speed, dt);
    r.working = distance < 1.65; r.mode = r.working ? "gather" : "seek";
    if (r.working) {
      const removed = snow.clear(r.group.position.x, r.group.position.z, 1.4 + b.level * 0.22, (8.4 + b.level * 3.1) * efficiency * this.relayBoosts.sweeper * dt);
      r.carry = Math.min(capacity, r.carry + removed * 0.58);
      if (r.carry >= capacity - 0.01 && r.dockWait <= 0) { r.returning = true; r.target = null; r.mode = "return"; }
    }
  }

  private nearestWarmPoint(x: number, z: number): { x: number; z: number } {
    let best: { x: number; z: number } = { x: GAME.baseCenter.x, z: GAME.baseCenter.z }; let bestDistance = Math.hypot(x - best.x, z - best.z);
    for (const heater of this.items) if (heater.type === "heater" && heater.powered && !heater.damaged) {
      const distance = Math.hypot(x - heater.x, z - heater.z);
      if (distance < bestDistance) { best = { x: heater.x, z: heater.z }; bestDistance = distance; }
    }
    return best;
  }

  private reservedRepairs(self: RobotEntity): { buildings: Set<number>; robots: Set<string> } {
    const buildings = new Set<number>(); const robots = new Set<string>();
    for (const item of this.items) for (const other of item.robots) {
      if (other === self || other.kind !== "hauler" || other.frozen || other.health <= 0 || other.destinationId <= 0) continue;
      if (other.sourceId === 0) buildings.add(other.destinationId);
      else robots.add(`${other.destinationId}:${other.sourceId}`);
    }
    return { buildings, robots };
  }

  private haulerColdDrain(storm: number): number {
    // Severe storms reach intensity 1.22. Budget for that even in calm weather
    // so a storm that starts on the way home cannot freeze the drone mid-return.
    return 0.44 + Math.max(storm, 1.22) * 0.95;
  }

  private thermalCost(meters: number, speed: number, storm: number): number {
    const padded = Math.max(0, meters) * 1.5;
    return this.haulerColdDrain(storm) * (padded / Math.max(0.45, speed) + 3.5);
  }

  private warmShelter(x: number, z: number): { x: number; z: number; gap: number } {
    const inset = 1.35;
    const zones: { x: number; z: number; r: number }[] = [{ x: GAME.baseCenter.x, z: GAME.baseCenter.z, r: GAME.baseHeatRadius }];
    for (const heater of this.items) if (heater.type === "heater" && heater.powered && !heater.damaged) zones.push({ x: heater.x, z: heater.z, r: 7 + (heater.level - 1) * 2 });
    for (const zone of this.auxiliaryZones) zones.push(zone);
    let best = zones[0];
    let gap = Math.max(0, Math.hypot(x - best.x, z - best.z) - Math.max(0.6, best.r - inset));
    for (const zone of zones) {
      const next = Math.max(0, Math.hypot(x - zone.x, z - zone.z) - Math.max(0.6, zone.r - inset));
      if (next < gap) { best = zone; gap = next; }
    }
    return { x: best.x, z: best.z, gap };
  }

  private patrolStand(b: BuildingEntity): { x: number; z: number } {
    const dock = { x: b.x + 2.4, z: b.z };
    if (this.warmingAt(dock.x, dock.z)) return dock;
    const shelter = this.warmShelter(dock.x, dock.z);
    return { x: shelter.x + 1.8, z: shelter.z };
  }

  private dutyGap(b: BuildingEntity, r: RobotEntity): number {
    const stand = this.patrolStand(b);
    let x = stand.x, z = stand.z;
    if (r.destinationId > 0 && r.sourceId === 0) {
      const damaged = this.items.find((item) => item.id === r.destinationId && item.damaged);
      if (damaged) { x = damaged.x + 2.1; z = damaged.z; }
    } else if (r.destinationId > 0 && r.sourceId > 0) {
      const host = this.items.find((item) => item.id === r.destinationId);
      const target = host?.robots.find((robot) => robot.slot === r.sourceId - 1 && robot.frozen);
      if (target) { x = target.group.position.x; z = target.group.position.z; }
    }
    return this.warmShelter(x, z).gap;
  }

  private needsWarmth(b: BuildingEntity, r: RobotEntity, speed: number, storm: number): boolean {
    const home = this.thermalCost(this.warmShelter(r.group.position.x, r.group.position.z).gap, speed, storm);
    if (!this.warmingAt(r.group.position.x, r.group.position.z)) {
      const working = r.mode === "repair" || r.mode === "rescue";
      const remain = r.mode === "repair" ? Math.max(0, 4.5 - r.rescue) : r.mode === "rescue" ? 3 : 0;
      if (working && r.temperature > home + this.haulerColdDrain(storm) * remain) return false;
      return r.temperature <= home;
    }
    const roundTrip = this.thermalCost(this.dutyGap(b, r) * 2, speed, storm);
    return r.temperature < Math.min(96, Math.max(roundTrip, home));
  }

  private flyToWarmth(r: RobotEntity, speed: number, dt: number): void {
    const shelter = this.warmShelter(r.group.position.x, r.group.position.z);
    if (this.warmingAt(r.group.position.x, r.group.position.z) && shelter.gap <= 0) {
      r.mode = "recharge"; r.moving = false; r.working = false; return;
    }
    this.moveTarget.set(shelter.x + 1.8, 0, shelter.z);
    this.moveRobot(r, this.moveTarget, speed, dt);
    const arrived = this.warmingAt(r.group.position.x, r.group.position.z);
    r.mode = arrived ? "recharge" : "warm-return";
    if (arrived) { r.moving = false; r.working = false; }
  }

  private updateRescue(b: BuildingEntity, r: RobotEntity, dt: number, storm: number): void {
    if (r.frozen) { r.moving = false; r.working = false; return; }
    r.timer -= dt; r.working = false; r.paymentWait = Math.max(0, r.paymentWait - dt);
    const warm = this.warmingAt(r.group.position.x, r.group.position.z);
    if (warm) r.energy = Math.min(100, r.energy + 28 * dt);
    const efficiency = Math.max(0.6, b.powerEfficiency);
    const speed = (7.2 + b.level * 0.8) * efficiency * (r.energy <= 0 ? 0.3 : 1);
    if (this.needsWarmth(b, r, speed, storm)) {
      // Keep the claimed target, weld timer, and any payment already taken.
      this.flyToWarmth(r, speed, dt);
      const drain = r.working ? 0.85 : r.moving ? 0.55 : 0.12;
      r.energy = Math.max(0, r.energy - drain * dt);
      return;
    }
    if (r.paymentWait > 0) { r.mode = "funding"; r.moving = false; return; }
    if (r.energy <= 24 || (r.mode === "recharge" && r.energy < 99.5)) {
      const point = this.nearestWarmPoint(r.group.position.x, r.group.position.z); this.moveTarget.set(point.x + 1.8, 0, point.z);
      const distance = this.moveRobot(r, this.moveTarget, speed, dt);
      r.mode = distance < (point.x === GAME.baseCenter.x && point.z === GAME.baseCenter.z ? GAME.baseHeatRadius * 0.7 : 3) ? "recharge" : "warm-return";
      if (r.mode === "recharge" && !warm) r.energy = Math.min(100, r.energy + 18 * dt);
    } else {
      const reserved = this.reservedRepairs(r);
      let damaged = r.repairAllowed ? this.items.find((item) => item.id === r.destinationId && item.damaged && r.sourceId === 0) : undefined;
      if (!damaged && r.sourceId === 0 && r.repairAllowed) {
        damaged = this.items.filter((item) => item.damaged && !reserved.buildings.has(item.id)).sort((a, c) => Math.hypot(a.x - r.group.position.x, a.z - r.group.position.z) - Math.hypot(c.x - r.group.position.x, c.z - r.group.position.z))[0];
        if ((damaged?.id ?? 0) !== r.destinationId) r.rescue = 0;
        r.destinationId = damaged?.id ?? 0;
      }
      if (damaged) {
        this.moveTarget.set(damaged.x + 2.1, 0, damaged.z);
        const distance = this.moveRobot(r, this.moveTarget, speed, dt); r.mode = distance < 3.2 ? "repair" : "repair-return";
        if (distance < 3.2) {
          r.working = true; r.moving = false; r.rescue += dt;
          if (r.rescue >= 4.5) {
            if (this.repair(damaged.id, (cost) => this.hooks.charge(cost, "building-repair"))) {
              this.hooks.repaired(damaged); r.rescue = 0; r.destinationId = 0;
            } else { r.rescue = 4.5; r.paymentWait = 2; r.mode = "funding"; r.working = false; }
          }
        }
      } else {
        let targetBuilding = this.items.find((item) => item.id === r.destinationId);
        let target = targetBuilding?.robots.find((robot) => robot.slot === r.sourceId - 1 && robot.frozen && robot !== r);
        if (!target) {
          let bestDistance = Number.POSITIVE_INFINITY; targetBuilding = undefined;
          for (const item of this.items) for (const robot of item.robots) if (robot !== r && robot.frozen && !reserved.robots.has(`${item.id}:${robot.slot + 1}`)) {
            const distance = Math.hypot(robot.group.position.x - r.group.position.x, robot.group.position.z - r.group.position.z);
            if (distance < bestDistance) { bestDistance = distance; target = robot; targetBuilding = item; }
          }
          r.destinationId = targetBuilding?.id ?? 0; r.sourceId = target ? target.slot + 1 : 0;
        }
        if (target && targetBuilding) {
          this.moveTarget.set(target.group.position.x, 0, target.group.position.z);
          const distance = this.moveRobot(r, this.moveTarget, speed, dt); r.mode = distance < 2.7 ? "rescue" : "rescue-return";
          if (distance < 2.7) {
            const needsPayment = target.rescue <= 0 && !target.rescuePaid;
            if (needsPayment && !this.hooks.charge(ROBOT_RESCUE_COST, "robot-rescue")) {
              r.paymentWait = 2; r.mode = "funding"; r.working = false; r.moving = false;
            } else {
              if (target.rescue <= 0) { target.rescue = target.rescuePaid ? Math.max(target.rescue, 3) : 3; target.thaw = 0; target.rescuePaid = true; }
              target.assisted = true; r.working = true; r.moving = false;
            }
          }
        } else {
          r.mode = "patrol"; r.destinationId = 0; r.sourceId = 0; r.rescue = 0;
          const stand = this.patrolStand(b);
          this.moveTarget.set(stand.x, 0, stand.z);
          const parked = this.warmingAt(r.group.position.x, r.group.position.z) && Math.hypot(r.group.position.x - stand.x, r.group.position.z - stand.z) <= 2.2;
          if (!parked) this.moveRobot(r, this.moveTarget, speed, dt);
          else r.moving = false;
        }
      }
    }
    const drain = r.working ? 0.85 : r.moving ? 0.55 : 0.12;
    r.energy = Math.max(0, r.energy - drain * dt);
  }

  refreshPowerGrid(): void {
    interface Source { key: string; x: number; z: number; radius: number; capacity: number; load: number; generator?: BuildingEntity }
    const sources: Source[] = [{ key: "base", x: GAME.baseCenter.x, z: GAME.baseCenter.z, radius: GAME.basePowerRadius, capacity: GAME.basePowerConnections, load: 0 }];
    const range = GAME.generatorCableRange; const base = GAME.baseCenter;
    const generators = this.items.filter((b) => b.type === "generator");
    for (const generator of generators) {
      generator.cableConnected = false; generator.powered = false; generator.powerSource = "none";
      generator.powerLoad = 0; generator.powerCapacity = 3 + generator.level - 1; generator.powerEfficiency = 0;
    }
    const queue: BuildingEntity[] = [];
    for (const generator of generators) if (!generator.damaged && Math.abs(generator.x - base.x) + Math.abs(generator.z - base.z) <= range) {
      generator.cableConnected = true; generator.powered = true; generator.powerSource = "base"; queue.push(generator);
    }
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      for (const generator of generators) if (!generator.powered && !generator.damaged && Math.abs(generator.x - node.x) + Math.abs(generator.z - node.z) <= range) {
        generator.cableConnected = true; generator.powered = true; generator.powerSource = `generator:${node.id}`; queue.push(generator);
      }
    }
    for (const generator of generators) if (generator.powered) sources.push({ key: `generator:${generator.id}`, x: generator.x, z: generator.z, radius: generatorRadius(generator.level), capacity: 3 + generator.level - 1, load: 0, generator });
    const consumers = this.items.filter((b) => b.type !== "generator");
    for (const b of consumers) {
      b.powerSource = "none"; b.powerLoad = 0; b.powerCapacity = 0; b.powerEfficiency = 0; b.powered = false;
      b.cableConnected = false;
    }
    const assigned = new Map<number, Source>();
    for (const b of consumers) {
      if (b.damaged) continue;
      const candidates = sources.filter((source) => Math.hypot(b.x - source.x, b.z - source.z) <= source.radius && source.load < source.capacity)
        .sort((a, c) => (a.load / a.capacity - c.load / c.capacity) || (Math.hypot(b.x - a.x, b.z - a.z) - Math.hypot(b.x - c.x, b.z - c.z)) || (a.key === "base" ? -1 : 1));
      const source = candidates[0];
      if (!source) continue;
      source.load++; assigned.set(b.id, source); b.powerSource = source.key; b.cableConnected = true;
    }
    this.relayLive = {};
    for (const site of this.relaySites) if (site.repaired) {
      const source = sources.filter((candidate) => Math.hypot(site.x - candidate.x, site.z - candidate.z) <= candidate.radius && candidate.load < candidate.capacity)
        .sort((a, c) => (a.load / a.capacity - c.load / c.capacity) || (Math.hypot(site.x - a.x, site.z - a.z) - Math.hypot(site.x - c.x, site.z - c.z)) || (a.key === "base" ? -1 : 1))[0];
      if (!source) continue;
      source.load++; this.relayLive[site.id] = true;
    }
    for (const source of sources) {
      const efficiency = source.load > 0 ? Math.max(0.5, 1 - 0.12 * (source.load - 1)) : 1;
      if (source.generator) {
        source.generator.powerLoad = source.load; source.generator.powerCapacity = source.capacity; source.generator.powerEfficiency = efficiency;
      }
    }
    for (const b of consumers) {
      const source = assigned.get(b.id);
      if (!source) continue;
      b.powerLoad = source.load; b.powerCapacity = source.capacity;
      b.powerEfficiency = Math.max(0.5, 1 - 0.12 * (source.load - 1));
      b.powered = !b.damaged;
    }
  }

  powerSnapshot(): Array<{ id: number; powered: boolean; source: string; load: number; capacity: number; efficiency: number; cable: boolean; wireMeshes: number }> {
    this.refreshPowerGrid();
    return this.items.map((b) => {
      let wireMeshes = 0; b.powerWire?.traverse((object) => { if (object instanceof THREE.Mesh) wireMeshes++; });
      return { id: b.id, powered: b.powered, source: b.powerSource, load: b.powerLoad, capacity: b.powerCapacity, efficiency: b.powerEfficiency, cable: b.cableConnected, wireMeshes };
    });
  }
  capacity(b: BuildingEntity): number { return BUILDINGS[b.type].capacity * (1 + (b.level - 1) * 0.55); }
  outputCapacity(b: BuildingEntity): number {
    // Output room grows with the same level steps as throughput, so a full input
    // tank is not stuck behind a buffer that filled before the upgrade could show.
    if (b.type === "press") return Math.round(28 * (1 + (b.level - 1) * 1.05));
    if (b.type === "purifier") return Math.round(BUILDINGS.purifier.capacity * (1 + (b.level - 1) * 1.05));
    if (b.type === "hauler") return 0;
    return this.capacity(b);
  }
  acceptInput(b: BuildingEntity, kind: CargoKind, amount: number): number {
    const compatible = (b.type === "purifier" && kind === "raw") || (b.type === "press" && kind === "purified");
    if (!compatible || amount <= 0 || b.damaged) return 0;
    const accepted = Math.min(amount, Math.max(0, this.capacity(b) - b.input));
    b.input += accepted; b.activity = 1; return accepted;
  }
  private refreshHeaterZones(): void {
    this.zones.length = 0;
    for (const b of this.items) if (b.type === "heater" && b.powered && !b.damaged) this.zones.push({ x: b.x, z: b.z, r: 7 + (b.level - 1) * 2 });
  }
  heaterZones(): CircleZone[] { return this.protectedZones(); }
  protectedZones(): CircleZone[] { return [...this.zones, ...this.auxiliaryZones]; }
  setAuxiliaryZones(zones: CircleZone[]): void { this.auxiliaryZones = zones.map((zone) => ({ ...zone })); }
  setRelayBoosts(sweeper: number, production: number): void { this.relayBoosts = { sweeper, production }; }
  setRelaySites(sites: Array<{ id: "gale" | "servo" | "foundry"; x: number; z: number; repaired: boolean }>): void { this.relaySites = sites.map((site) => ({ ...site })); }
  relayPowered(id: "gale" | "servo" | "foundry"): boolean { return !!this.relayLive[id]; }
  /** A generator is linked when a 68 m Manhattan cable reaches the base or another linked generator. */
  generatorReaches(x: number, z: number, ignoreId?: number): boolean {
    const range = GAME.generatorCableRange; const base = GAME.baseCenter;
    if (Math.abs(x - base.x) + Math.abs(z - base.z) <= range) return true;
    const open: Array<{ id: number; x: number; z: number }> = [];
    const seen = new Set<number>();
    for (const generator of this.items) if (generator.type === "generator" && generator.id !== ignoreId && !generator.damaged && Math.abs(generator.x - base.x) + Math.abs(generator.z - base.z) <= range) {
      open.push(generator); seen.add(generator.id);
    }
    for (let i = 0; i < open.length; i++) {
      const node = open[i];
      if (Math.abs(x - node.x) + Math.abs(z - node.z) <= range) return true;
      for (const generator of this.items) if (generator.type === "generator" && generator.id !== ignoreId && !generator.damaged && !seen.has(generator.id) && Math.abs(generator.x - node.x) + Math.abs(generator.z - node.z) <= range) {
        seen.add(generator.id); open.push(generator);
      }
    }
    return false;
  }
  warmingAt(x: number, z: number): boolean {
    if (Math.hypot(x - GAME.baseCenter.x, z - GAME.baseCenter.z) < GAME.baseHeatRadius) return true;
    for (const zone of this.protectedZones()) if (Math.hypot(x - zone.x, z - zone.z) < zone.r) return true;
    return false;
  }

  private noteFreeze(b: BuildingEntity, r: RobotEntity, storm: number): void {
    this.freezeEvents.push({
      time: this.time, id: b.id, slot: r.slot, kind: r.kind,
      x: r.group.position.x, z: r.group.position.z, mode: r.mode,
      carry: r.carry, returning: r.returning,
      gap: this.warmShelter(r.group.position.x, r.group.position.z).gap, storm,
    });
    if (this.freezeEvents.length > 160) this.freezeEvents.shift();
  }

  private updateRobotThermal(r: RobotEntity, dt: number, storm: number, rescuer?: { x: number; z: number }): void {
    const p = r.group.position; const warm = this.warmingAt(p.x, p.z);
    if (r.frozen && r.rescue > 0 && (r.assisted || (rescuer && Math.hypot(rescuer.x - p.x, rescuer.z - p.z) < 3.5))) {
      r.rescue = Math.max(0, r.rescue - dt); r.thaw = 1 - r.rescue / 3; r.temperature = Math.min(100, r.temperature + 38 * dt);
      if (r.rescue <= 0 || r.temperature >= 65) { r.frozen = false; r.temperature = Math.max(65, r.temperature); r.rescue = 0; r.thaw = 0; r.rescuePaid = false; }
    } else if (warm) {
      if (!r.frozen) r.temperature = Math.min(100, r.temperature + 30 * dt);
      else if (r.kind === "hauler") {
        // Heat can finish a thaw that started inside a working warm zone. The
        // drone stays grounded until 65, the same point an assisted thaw clears.
        r.temperature = Math.min(100, r.temperature + 6 * dt);
        if (r.temperature >= 65) { r.frozen = false; r.temperature = Math.max(65, r.temperature); r.rescue = 0; r.thaw = 0; r.rescuePaid = false; }
      } else r.temperature = Math.min(35, r.temperature + 6 * dt);
    } else {
      // Only a frozen target loses an interrupted thaw. A working rescuer uses
      // the same timer for welding and must keep that progress in cold weather.
      if (r.frozen && r.rescue > 0 && !r.rescuePaid) { r.rescue = 0; r.thaw = 0; }
      if (!r.frozen) {
        const drain = r.kind === "hauler" ? 0.44 + storm * 0.95 : 0.62 + storm * 1.35;
        r.temperature = Math.max(0, r.temperature - drain * dt);
      }
      if (r.temperature <= 0 && !r.frozen) { r.frozen = true; r.moving = false; r.working = false; this.hooks.frozen(); }
    }
    r.frost.visible = r.frozen;
    if (r.frozen) r.frost.rotation.y += dt * 0.45;
  }

  private animateRobot(b: BuildingEntity, r: RobotEntity, dt: number): void {
    const stride = this.time * 11 + b.id + r.slot;
    r.visual.position.y = r.frozen ? 0 : r.moving ? Math.abs(Math.sin(stride)) * 0.075 : Math.sin(this.time * 2 + b.id) * 0.018;
    r.visual.rotation.z = r.frozen ? 0.16 : r.moving ? Math.sin(stride * 0.5) * 0.055 : 0;
    r.visual.rotation.x = r.working && !r.frozen ? Math.sin(this.time * 24) * 0.025 : 0;
    const alive = !r.frozen && r.health > 0 && !b.damaged && b.powered;
    if (r.kind === "sweeper") {
      const brushRate = alive && r.working ? 16 : alive && r.moving ? 8 : 0;
      for (const part of r.motionRig.children) part.rotation.x += dt * brushRate;
    } else {
      const targetRate = !alive ? 0 : r.moving || r.working ? 22 : 9;
      const currentRate = Number(r.motionRig.userData.rotorSpeed) || 0;
      const rotorSpeed = currentRate + (targetRate - currentRate) * (1 - Math.exp(-5 * dt));
      r.motionRig.userData.rotorSpeed = rotorSpeed;
      const repairing = alive && r.working && (r.mode === "repair" || r.mode === "rescue");
      for (const part of r.motionRig.children) {
        if (part.userData.rotor) part.rotation.y += dt * rotorSpeed;
        else if (part.userData.welder) {
          const nod = repairing ? Math.sin(this.time * 8) * 0.16 : 0;
          const sway = repairing ? Math.sin(this.time * 5.4) * 0.1 : 0;
          part.rotation.x += (-0.4 + nod - part.rotation.x) * (1 - Math.exp(-8 * dt));
          part.rotation.z += (sway - part.rotation.z) * (1 - Math.exp(-8 * dt));
        }
      }
    }
    if (r.kind === "hauler") { r.visual.rotation.z = 0; r.visual.rotation.x = 0; r.visual.position.y += 0.65; r.motionRig.position.y = r.visual.position.y; }
    else r.motionRig.position.y = r.visual.position.y;
    const frostMat = r.frost.material as THREE.MeshBasicMaterial; frostMat.opacity = 0.28 + Math.sin(this.time * 4) * 0.08;
  }

  update(dt: number, snow: SnowField, storm = 0, rescuer?: { x: number; z: number }, player?: { x: number; z: number }): void {
    this.time += dt; this.currentSnow = snow; this.refreshPowerGrid(); this.refreshHeaterZones(); this.flushRetained(); snow.melt(dt, this.protectedZones());
    for (const b of this.items) for (const r of b.robots) r.assisted = false;
    // Rescue units run before thermal updates so their assistance is visible in the same fixed tick.
    for (const b of this.items) if (b.type === "hauler" && b.powered && !b.damaged) for (const r of b.robots) if (r.health > 0) this.updateRescue(b, r, dt, storm);
    for (const b of this.items) {
      const anyFrozen = b.robots.some((r) => r.frozen);
      b.status.color.setHex(b.damaged ? 0xff6655 : anyFrozen ? 0x8edfff : b.powered ? COLORS.cyan : 0x7d4c45); b.status.emissive.copy(b.status.color);
      b.ring.visible = (b.type === "heater" || b.type === "generator") && b.powered && !b.damaged;
      b.ring.scale.setScalar(b.type === "heater" ? 7 + (b.level - 1) * 2 : b.type === "generator" ? generatorRadius(b.level) : 2);
      b.damageVisual.visible = b.damaged; this.updateStatusBadge(b);
      if (b.damaged) {
        const beacon = b.damageVisual.getObjectByName("damage-beacon"); if (beacon) { beacon.rotation.y += dt * 1.8; beacon.scale.setScalar(0.92 + Math.sin(this.time * 5) * 0.1); }
        const smoke = b.damageVisual.getObjectByName("damage-smoke");
        smoke?.children.forEach((puff, i) => { puff.position.y = 1.5 + ((this.time * 0.32 + i * 0.24) % 1) * 1.65; puff.position.x = Math.sin(this.time * 0.8 + i * 2) * 0.28; puff.rotation.y += dt * 0.4; });
      }
      b.spawn = Math.min(1, b.spawn + dt * 3.4); b.activity = Math.max(0, b.activity - dt * 1.6);
      const spawnScale = 1 - Math.pow(1 - b.spawn, 3);
      b.group.scale.set(spawnScale, spawnScale * (1 + Math.sin(this.time * 13 + b.id) * 0.018 * b.activity), spawnScale);
      if (b.type === "purifier") b.moving.rotation.y += dt * (b.input > 0 && b.powered ? 4.5 : 0.35);
      else if (b.type === "press") b.moving.position.y = -Math.sin(Math.min(1, b.progress / 2.8) * Math.PI) * 0.45 + b.activity * 0.08;
      else if (b.type === "heater") {
        b.moving.rotation.y += dt * (b.powered ? 0.8 : 0.1);
        const coils = b.moving.userData.coils as THREE.Mesh[] | undefined;
        coils?.forEach((coil, i) => { const pulse = 1 + Math.max(0, Math.sin(this.time * 4.2 - i * 1.25)) * 0.2 * (b.powered ? 1 : 0); coil.scale.setScalar(pulse); });
        const pulses = b.moving.userData.pulses as THREE.Mesh[] | undefined;
        pulses?.forEach((pulse, i) => { const phase = (this.time * 0.65 + i * 0.5) % 1; pulse.position.y = 1.25 + phase * 1.05; pulse.scale.setScalar(0.6 + Math.sin(phase * Math.PI) * 0.8); pulse.visible = b.powered; });
      }
      else if (b.type === "generator") { b.moving.rotation.y += dt * (b.powered ? 1.8 : 0); b.moving.rotation.z = Math.sin(this.time * 0.7) * 0.08; }
      else if (b.type === "sweeper" || b.type === "hauler") {
        b.moving.rotation.y += dt * (b.type === "sweeper" ? 1.4 : -0.9);
        b.moving.position.y = Math.max(0, Math.sin(this.time * (b.type === "sweeper" ? 4 : 2.5) + b.id)) * (b.output > 0 ? 0.18 : 0.05);
      }
      for (const r of b.robots) {
        r.group.position.y = snow.heightAt(r.group.position.x, r.group.position.z) + (r.kind === "hauler" ? 0.18 : 0.06);
        if (!b.damaged && !r.frozen && (r.moving || r.working)) r.health = Math.max(0, r.health - 0.035 * dt);
        if (r.health <= 0) { r.mode = "damaged"; r.target = null; r.moving = false; r.working = false; }
        if (b.damaged) { r.mode = "damaged"; r.moving = false; r.working = false; }
        const wasFrozen = r.frozen;
        this.updateRobotThermal(r, dt, storm, rescuer);
        if (!wasFrozen && r.frozen) this.noteFreeze(b, r, storm);
        if (b.type === "sweeper" && !b.powered && !b.damaged && !r.frozen && r.health > 0) this.directSweeperHeat(b, r, dt, storm);
        this.animateRobot(b, r, dt);
      }
      if (!b.powered || b.damaged) continue;
      if (b.type === "purifier") {
        const room = Math.max(0, this.outputCapacity(b) - b.output);
        const amount = Math.min(b.input, room / 0.85, BUILDINGS.purifier.rate * (1 + (b.level - 1) * 0.9) * this.relayBoosts.production * Math.max(0.5, b.powerEfficiency) * dt);
        if (amount > 0) { b.input -= amount; const made = amount * 0.85; b.output += made; b.activity = Math.max(b.activity, 0.28); this.hooks.produced(made); }
      } else if (b.type === "press") {
        // Reserve a complete batch once. Partial rail deliveries can then accumulate
        // without resetting work or reporting a false missing-input warning.
        const cap = this.outputCapacity(b);
        const pace = (1 + (b.level - 1) * 0.9) * this.relayBoosts.production * Math.max(0.5, b.powerEfficiency);
        if (b.progress <= 0 && b.input >= 5 && b.output < cap - 1e-3) { b.input -= 5; b.progress = 0.0001; }
        if (b.progress > 0 && b.output < cap - 1e-3) {
          let time = dt * pace; let guard = 0;
          while (time > 0 && b.progress > 0 && b.output < cap - 1e-3 && guard++ < 12) {
            const used = Math.min(time, 2.4 - b.progress);
            b.progress += used; time -= used; b.activity = 1;
            if (b.progress >= 2.4 - 1e-6) {
              b.progress = 0; b.output += 1;
              if (time > 0 && b.input >= 5 && b.output < cap - 1e-3) { b.input -= 5; b.progress = 0.0001; }
              else break;
            }
          }
        }
      } else if (b.type === "sweeper") {
        for (const r of b.robots) if (!r.frozen && r.health > 0) this.updateSweeper(b, r, snow, dt, storm, player);
      }
    }
  }

  nearest(x: number, z: number, range = 3.5): BuildingEntity | null {
    let best: BuildingEntity | null = null; let bestD = range;
    for (const b of this.items) { const d = Math.hypot(x - b.x, z - b.z); if (d < bestD) { best = b; bestD = d; } }
    return best;
  }
  nearestFrozen(x: number, z: number, range = 3.4): BuildingEntity | null {
    let best: BuildingEntity | null = null; let bestD = range;
    for (const b of this.items) for (const r of b.robots) if (r.frozen) {
      const d = Math.hypot(x - r.group.position.x, z - r.group.position.z); if (d < bestD) { best = b; bestD = d; }
    }
    return best;
  }
  startRescue(x: number, z: number): "none" | "started" | "active" | "funding" {
    let best: RobotEntity | null = null; let bestD = 3.4;
    for (const b of this.items) for (const r of b.robots) if (r.frozen) {
      const d = Math.hypot(x - r.group.position.x, z - r.group.position.z); if (d < bestD) { best = r; bestD = d; }
    }
    if (!best) return "none";
    if (best.rescue > 0 || best.assisted) return "active";
    if (best.rescuePaid) { best.rescue = 3; best.thaw = 0; return "active"; }
    if (!this.hooks.charge(MANUAL_RESCUE_COST, "manual-rescue")) return "funding";
    best.rescue = 3; best.thaw = 0; best.rescuePaid = true; return "started";
  }
  setRepairAllowed(id: number, slot: number, allowed: boolean): boolean {
    const b = this.byId(id); const robot = b?.robots.find((r) => r.slot === slot && r.kind === "hauler");
    if (!robot) return false;
    robot.repairAllowed = allowed; robot.destinationId = 0; robot.sourceId = 0; robot.rescue = 0; robot.path = [];
    return true;
  }
  byId(id: number): BuildingEntity | undefined { return this.items.find((b) => b.id === id); }
  cargoKind(b: BuildingEntity): CargoKind | null { return b.type === "purifier" ? "purified" : b.type === "press" ? "ice" : b.type === "sweeper" ? "raw" : null; }
  retainCargo(kind: CargoKind, amount: number): void { if (amount > 0 && Number.isFinite(amount)) this.retained[kind] += amount; }
  retainedCargo(): Record<CargoKind, number> { return { raw: this.retained.raw, purified: this.retained.purified, ice: this.retained.ice }; }
  restoreRetained(cargo?: Partial<Record<CargoKind, number>>): void {
    this.retained = { raw: Math.max(0, Number(cargo?.raw) || 0), purified: Math.max(0, Number(cargo?.purified) || 0), ice: Math.max(0, Number(cargo?.ice) || 0) };
  }
  private flushRetained(): void {
    for (const kind of ["raw", "purified", "ice"] as const) {
      let left = this.retained[kind];
      if (left <= 1e-4) { this.retained[kind] = 0; continue; }
      for (const building of this.items) {
        if (left <= 1e-4 || this.cargoKind(building) !== kind || building.damaged) continue;
        const room = Math.max(0, this.outputCapacity(building) - building.output);
        const moved = Math.min(left, room); building.output += moved; left -= moved;
      }
      for (const building of this.items) { if (left <= 1e-4) break; left -= this.acceptInput(building, kind, left); }
      this.retained[kind] = left <= 1e-4 ? 0 : left;
    }
  }
  drainOutput(b: BuildingEntity, max: number): number { const n = Math.min(max, b.output); b.output -= n; b.activity = 1; return n; }

  interact(b: BuildingEntity, carried: number, maxCollect = Number.POSITIVE_INFINITY): { accepted: number; collected: number; kind: CargoKind | null } {
    const kind = this.cargoKind(b);
    if (b.damaged) return { accepted: 0, collected: 0, kind: null };
    if ((b.type === "purifier" || b.type === "press") && carried > 0) {
      const accepted = Math.min(carried, Math.max(0, this.capacity(b) - b.input)); b.input += accepted; b.activity = 1;
      if (accepted > 0) return { accepted, collected: 0, kind: null };
    }
    if (b.type === "sweeper" && carried > 0) {
      const accepted = Math.min(carried, Math.max(0, this.outputCapacity(b) - b.output));
      b.output += accepted; b.activity = 1; if (accepted > 0) return { accepted, collected: 0, kind: null };
    }
    if (kind && b.output > 0 && maxCollect > 0) { const collected = this.drainOutput(b, maxCollect); return { accepted: 0, collected, kind }; }
    return { accepted: 0, collected: 0, kind: null };
  }

  upgradeCost(b: BuildingEntity): number { return b.level >= 3 ? 0 : Math.round(BUILDINGS[b.type].upgradeCost * b.level); }
  upgrade(b: BuildingEntity, charge: (cost: number) => boolean): boolean {
    const cost = this.upgradeCost(b); if (!cost || b.damaged || !charge(cost)) return false;
    b.level++; b.activity = 1;
    if (b.workArea) { b.workArea.radius = workAreaRadius(b.level); for (const robot of b.robots) if (robot.zoneMode === "area") this.applyArea(b, robot); }
    for (const r of b.robots) if (r.zoneMode === "auto") { r.zoneRange = 12 + b.level * 4; r.searchRange = r.zoneRange; }
    this.refreshLevelDetails(b); this.refreshPowerGrid(); return true;
  }
  count(type: BuildingType): number { return this.items.filter((b) => b.type === type).length; }
  robotCount(): number { return this.items.reduce((sum, b) => sum + b.robots.length, 0); }
  frozenCount(): number { return this.items.reduce((sum, b) => sum + b.robots.filter((r) => r.frozen).length, 0); }
  repairCost(b: BuildingEntity): number { return Math.max(45, Math.round(BUILDINGS[b.type].cost * (0.18 + b.level * 0.04))); }
  damage(id: number): boolean {
    const b = this.byId(id); if (!b || b.damaged) return false;
    b.damaged = true; b.powered = false; if (b.type === "press" && b.progress > 0) b.input = Math.min(this.capacity(b), b.input + 5); b.progress = 0; b.activity = 0; b.damageVisual.visible = true; this.hooks.alert(b, "damage");
    for (const r of b.robots) { r.mode = "damaged"; r.target = null; r.moving = false; r.working = false; }
    this.refreshPowerGrid(); this.refreshHeaterZones(); return true;
  }
  repair(id: number, charge: (cost: number) => boolean): boolean {
    const b = this.byId(id); if (!b?.damaged || !charge(this.repairCost(b))) return false;
    b.damaged = false; b.damageVisual.visible = false; b.activity = 1;
    for (const r of b.robots) {
      // Structural repair restores durability, never bypasses the separate paid thaw.
      r.health = 100; r.frost.visible = r.frozen;
      r.energy = Math.max(70, r.energy); r.rescue = 0; r.thaw = 0; r.target = null; r.timer = 0; r.returning = r.kind === "sweeper" && r.carry > 0.01;
      r.sourceId = 0; r.destinationId = 0; r.mode = r.frozen ? "wait" : r.returning ? "return" : r.kind === "hauler" ? "patrol" : "seek";
    }
    this.refreshPowerGrid(); this.refreshHeaterZones(); return true;
  }
  robotServiceCost(b: BuildingEntity): number {
    const worn = b.robots.filter((r) => r.health <= 0).length;
    return worn ? worn * (b.type === "hauler" ? 140 : 90) : 0;
  }
  serviceRobots(id: number, charge: (cost: number) => boolean): boolean {
    const b = this.byId(id); const cost = b ? this.robotServiceCost(b) : 0;
    if (!b || b.damaged || !cost || !charge(cost)) return false;
    for (const r of b.robots) if (r.health <= 0) {
      r.health = 100; r.target = null; r.path = []; r.timer = 0;
      r.returning = r.kind === "sweeper" && r.carry > 0.01;
      r.mode = r.frozen ? "wait" : r.returning ? "return" : r.kind === "hauler" ? "patrol" : "seek";
    }
    return true;
  }
  demolitionRefund(b: BuildingEntity): number {
    let invested = BUILDINGS[b.type].cost;
    for (let level = 1; level < b.level; level++) invested += BUILDINGS[b.type].upgradeCost * level;
    if (b.type === "sweeper") invested += Math.max(0, b.robots.length - 1) * extraSweeperRobotCost();
    return Math.round(invested * 0.5);
  }
  views(x: number, z: number): BuildView[] {
    this.refreshPowerGrid();
    return this.items.map((b) => {
      const primary = b.robot;
      const robots = b.robots.map((r) => ({
        buildingId: b.id, slot: r.slot, kind: r.kind, x: r.group.position.x, z: r.group.position.z,
        frozen: r.frozen, temperature: r.temperature, thaw: r.thaw, health: r.health, carry: r.carry,
        capacity: r.kind === "sweeper" ? 20 + b.level * 6 : 0, mode: r.mode, energy: r.energy,
        zoneAuto: r.zoneAuto, zoneX: r.zoneMode === "auto" ? b.x : r.zoneX, zoneZ: r.zoneMode === "auto" ? b.z : r.zoneZ,
        zoneRange: r.zoneRange, zoneMode: r.zoneMode, chunkQuota: this.chunkQuota(b), activeChunk: r.activeChunk, areaFallback: r.areaFallback,
        chunkProgress: r.chunkProgress, chunkIds: [...r.chunkIds], repairAllowed: r.repairAllowed,
      }));
      return {
        id: b.id, type: b.type, x: b.x, z: b.z, level: b.level, input: b.input, output: b.output,
        inputCapacity: b.type === "purifier" || b.type === "press" ? this.capacity(b) : 0,
        outputCapacity: this.outputCapacity(b), powered: b.powered, near: Math.hypot(x - b.x, z - b.z) < 3.5,
        progress: b.type === "press" ? b.progress / 2.4 : 0,
        damaged: b.damaged, repairCost: this.repairCost(b), powerSource: b.powerSource,
        powerLoad: b.powerLoad, powerCapacity: b.powerCapacity, powerEfficiency: b.powerEfficiency,
        cableConnected: b.cableConnected,
        robotFrozen: primary?.frozen, robotTemperature: primary?.temperature, robotThaw: primary?.thaw, robotHealth: primary?.health,
        robotCarry: primary?.carry, robotCapacity: primary ? (primary.kind === "sweeper" ? 20 + b.level * 6 : 0) : undefined,
        robotMode: primary?.mode, robotRole: primary?.kind, robots,
        extraRobotCost: b.type === "sweeper" ? extraSweeperRobotCost() : undefined,
        robotServiceCost: this.robotServiceCost(b),
        generatorRadius: b.type === "generator" ? generatorRadius(b.level) : undefined,
        factoryState: this.factoryState(b),
        productionRate: b.type === "purifier" ? BUILDINGS.purifier.rate * (1 + (b.level - 1) * 0.9) * this.relayBoosts.production * Math.max(0.5, b.powerEfficiency) * 0.85 : b.type === "press" ? 60 / 2.4 * (1 + (b.level - 1) * 0.9) * this.relayBoosts.production * Math.max(0.5, b.powerEfficiency) : undefined,
        nextProductionRate: b.level < 3 && b.type === "purifier" ? BUILDINGS.purifier.rate * (1 + b.level * 0.9) * this.relayBoosts.production * Math.max(0.5, b.powerEfficiency) * 0.85 : b.level < 3 && b.type === "press" ? 60 / 2.4 * (1 + b.level * 0.9) * this.relayBoosts.production * Math.max(0.5, b.powerEfficiency) : undefined,
        productionUnit: b.type === "purifier" ? "purified" : b.type === "press" ? "ice" : undefined,
        workArea: b.workArea ? { ...b.workArea, fallback: b.robots.some((robot) => robot.zoneMode === "area" && robot.areaFallback) } : null,
      };
    });
  }

  forecastPower(type: BuildingType, x: number, z: number, ignoreId?: number): PowerForecast {
    interface Source { key: string; x: number; z: number; radius: number; capacity: number; load: number }
    const sources: Source[] = [{ key: "base", x: GAME.baseCenter.x, z: GAME.baseCenter.z, radius: GAME.basePowerRadius, capacity: GAME.basePowerConnections, load: 0 }];
    for (const generator of this.items) if (generator.type === "generator" && generator.id !== ignoreId && !generator.damaged && this.generatorReaches(generator.x, generator.z, ignoreId)) {
      sources.push({ key: `generator:${generator.id}`, x: generator.x, z: generator.z, radius: generatorRadius(generator.level), capacity: 3 + generator.level - 1, load: 0 });
    }
    const assign = (px: number, pz: number) => sources.filter((source) => Math.hypot(px - source.x, pz - source.z) <= source.radius && source.load < source.capacity)
      .sort((a, c) => (a.load / a.capacity - c.load / c.capacity) || (Math.hypot(px - a.x, pz - a.z) - Math.hypot(px - c.x, pz - c.z)) || (a.key === "base" ? -1 : 1))[0];
    for (const building of this.items) if (building.type !== "generator" && building.id !== ignoreId && !building.damaged) {
      const source = assign(building.x, building.z); if (source) source.load++;
    }
    for (const site of this.relaySites) if (site.repaired) { const source = assign(site.x, site.z); if (source) source.load++; }
    const networkFull = sources.every((source) => source.load >= source.capacity);
    if (type === "generator") {
      const cable = this.generatorReaches(x, z, ignoreId);
      return { consumesPower: false, connected: cable, source: cable ? "base" : "none", load: 0, capacity: 3, efficiency: 1, networkFull, reason: cable ? "generator" : "cable" };
    }
    const chosen = assign(x, z);
    if (!chosen) return { consumesPower: true, connected: false, source: "none", load: 0, capacity: 0, efficiency: 0, networkFull, reason: networkFull ? "network-full" : "no-connection" };
    const load = chosen.load + 1;
    return { consumesPower: true, connected: true, source: chosen.key, load, capacity: chosen.capacity, efficiency: Math.max(0.5, 1 - 0.12 * (load - 1)), networkFull: false, reason: "ok" };
  }

  validPlacement(x: number, z: number, radius: number, ignoreId?: number, player?: { x: number; z: number }): boolean {
    if (Math.abs(x) > GAME.worldLimit - 2 || Math.abs(z) > GAME.worldLimit - 2) return false;
    if (player && Math.hypot(x - player.x, z - player.z) < radius + 0.9) return false;
    const ignored = ignoreId === undefined ? null : this.byId(ignoreId)?.obstacle;
    for (const o of this.world.obstacles) if (o !== ignored && Math.hypot(x - o.x, z - o.z) < radius + o.r + 0.7) return false;
    return true;
  }

  private rebuildDynamicPhysics(): void {
    this.physics.clearDynamic();
    for (const b of this.items) this.physics.addCircle(b.obstacle);
  }
  relocate(id: number, x: number, z: number): boolean {
    const b = this.byId(id); if (!b || !this.validPlacement(x, z, BUILDINGS[b.type].radius, id)) return false;
    if (b.type === "generator" && !this.generatorReaches(x, z, id)) return false;
    if (b.type !== "generator" && !this.forecastPower(b.type, x, z, id).connected) return false;
    b.x = x; b.z = z; b.obstacle.x = x; b.obstacle.z = z;
    b.group.position.set(x, groundHeight(x, z) + 0.04, z); b.activity = 1; this.createPowerWire(b);
    for (const r of b.robots) {
      r.target = null; r.district = r.slot * 2; r.timer = 0;
      if (r.zoneAuto) { r.zoneX = x; r.zoneZ = z; }
      r.returning = r.kind === "sweeper" && r.carry > 0.01;
      r.mode = r.returning ? "return" : r.kind === "hauler" ? "patrol" : "seek";
    }
    this.rebuildDynamicPhysics(); this.refreshPowerGrid(); this.refreshHeaterZones(); this.navigation.rebuild(this.world.obstacles); return true;
  }
  demolish(id: number): BuildingEntity | null {
    const index = this.items.findIndex((b) => b.id === id); if (index < 0) return null;
    const b = this.items[index]; this.group.remove(b.group); disposeObject(b.group); b.status.dispose(); const badgeMaterial = b.statusBadge.material as THREE.SpriteMaterial; badgeMaterial.map?.dispose(); badgeMaterial.dispose(); if (b.powerWire) { this.group.remove(b.powerWire); disposeObject(b.powerWire); } for (const r of b.robots) { this.group.remove(r.group); disposeObject(r.group); this.group.remove(r.chunkMarker); disposeObject(r.chunkMarker, true); }
    const obstacleIndex = this.world.obstacles.indexOf(b.obstacle); if (obstacleIndex >= 0) this.world.obstacles.splice(obstacleIndex, 1);
    this.items.splice(index, 1); this.rebuildDynamicPhysics(); this.refreshPowerGrid(); this.refreshHeaterZones(); this.navigation.rebuild(this.world.obstacles); return b;
  }

  serialize(): SavedBuilding[] {
    return this.items.map((b) => ({
      id: b.id, type: b.type, x: b.x, z: b.z, level: b.level, input: b.input, output: b.output, progress: b.progress, damaged: b.damaged,
      workArea: b.workArea ? { ...b.workArea } : null,
      robotTemperature: b.robot?.temperature, robotFrozen: b.robot?.frozen, robotX: b.robot?.group.position.x, robotZ: b.robot?.group.position.z,
      robotCarry: b.robot?.carry, robotMode: b.robot?.mode, robotReturning: b.robot?.returning,
      robotSourceId: b.robot?.sourceId, robotDestinationId: b.robot?.destinationId, robotDistrict: b.robot?.district, robotHealth: b.robot?.health,
      robots: b.robots.map((r) => ({
        slot: r.slot, x: r.group.position.x, z: r.group.position.z, carry: r.carry, mode: r.mode, returning: r.returning,
        sourceId: r.sourceId, destinationId: r.destinationId, district: r.district, health: r.health,
        temperature: r.temperature, frozen: r.frozen, energy: r.energy,
        zoneAuto: r.zoneAuto, zoneX: r.zoneX, zoneZ: r.zoneZ, zoneRange: r.zoneRange,
        zoneMode: r.zoneMode, activeChunk: r.activeChunk, chunkIds: [...r.chunkIds], repairAllowed: r.repairAllowed,
        rescue: r.rescue, thaw: r.thaw, rescuePaid: r.rescuePaid, paymentWait: r.paymentWait,
      })),
    }));
  }
  restore(items: SavedBuilding[]): void {
    this.reset();
    for (const saved of items) {
      const b = this.build(saved.type, saved.x, saved.z, () => true, true); if (!b) continue;
      b.id = saved.id; b.level = saved.level; b.input = saved.input; b.output = saved.output; b.progress = saved.progress ?? 0; b.damaged = saved.damaged ?? false;
      const area = saved.workArea;
      b.workArea = area && Number.isFinite(area.x) && Number.isFinite(area.z) && area.radius > 0 ? { x: area.x, z: area.z, radius: area.radius } : null;
      this.nextId = Math.max(this.nextId, saved.id + 1); this.refreshLevelDetails(b);
      const desired = Math.max(1, Math.min(b.type === "sweeper" ? 3 : 1, saved.robots?.length ?? 1));
      while (b.robots.length < desired && (b.type === "sweeper" || b.type === "hauler")) this.spawnRobot(b);
      for (const r of b.robots) {
        const data = saved.robots?.find((robot) => robot.slot === r.slot);
        const x = data?.x ?? (r.slot === 0 ? saved.robotX : undefined) ?? b.x + 2 + r.slot * 0.7;
        const z = data?.z ?? (r.slot === 0 ? saved.robotZ : undefined) ?? b.z + r.slot * 0.65;
        r.group.position.set(x, groundHeight(x, z) + 0.06, z);
        r.temperature = data?.temperature ?? (r.slot === 0 ? saved.robotTemperature : undefined) ?? 100;
        r.frozen = data?.frozen ?? (r.slot === 0 ? saved.robotFrozen : undefined) ?? false; r.frost.visible = r.frozen;
        r.carry = r.kind === "sweeper" ? Math.max(0, data?.carry ?? (r.slot === 0 ? saved.robotCarry : undefined) ?? 0) : 0;
        r.health = Math.max(0, Math.min(100, data?.health ?? (r.slot === 0 ? saved.robotHealth : undefined) ?? 100));
        r.returning = r.kind === "sweeper" && (data?.returning ?? (r.slot === 0 ? saved.robotReturning : undefined) ?? r.carry > 0.01);
        r.sourceId = data?.sourceId ?? (r.slot === 0 ? saved.robotSourceId : undefined) ?? 0;
        r.destinationId = data?.destinationId ?? (r.slot === 0 ? saved.robotDestinationId : undefined) ?? 0;
        r.district = data?.district ?? (r.slot === 0 ? saved.robotDistrict : undefined) ?? r.slot * 2;
        r.energy = Math.max(0, Math.min(100, data?.energy ?? 100));
        r.zoneAuto = data?.zoneAuto ?? true; r.zoneX = data?.zoneX ?? b.x; r.zoneZ = data?.zoneZ ?? b.z;
        const savedMode = data?.zoneMode; const known = savedMode === "auto" || savedMode === "follow" || savedMode === "custom" || savedMode === "shelter" || savedMode === "supply" || savedMode === "area";
        r.zoneMode = known ? savedMode : (r.zoneAuto ? "auto" : "custom"); r.zoneAuto = r.zoneMode === "auto";
        r.searchRange = THREE.MathUtils.clamp(data?.zoneRange ?? 12 + b.level * 4, 8, GAME.worldSize); r.zoneRange = r.searchRange;
        r.activeChunk = data?.activeChunk ?? -1; r.chunkIds = [...(data?.chunkIds ?? [])]; r.target = null; r.timer = 0; r.path = []; r.navVersion = -1;
        r.repairAllowed = data?.repairAllowed ?? true; r.paymentWait = data?.paymentWait ?? 0;
        r.rescue = Math.max(0, data?.rescue ?? 0); r.thaw = THREE.MathUtils.clamp(data?.thaw ?? 0, 0, 1); r.rescuePaid = data?.rescuePaid ?? r.rescue > 0;
        r.mode = b.damaged || r.health <= 0 ? "damaged" : r.kind === "hauler" ? "patrol" : data?.mode ?? (r.slot === 0 ? saved.robotMode : undefined) ?? (r.returning ? "return" : "seek");
      }
    }
    this.refreshPowerGrid(); this.refreshHeaterZones();
  }
  reset(): void {
    for (const b of this.items) { this.group.remove(b.group); disposeObject(b.group); b.status.dispose(); const badgeMaterial = b.statusBadge.material as THREE.SpriteMaterial; badgeMaterial.map?.dispose(); badgeMaterial.dispose(); if (b.powerWire) { this.group.remove(b.powerWire); disposeObject(b.powerWire); } for (const r of b.robots) { this.group.remove(r.group); disposeObject(r.group); this.group.remove(r.chunkMarker); disposeObject(r.chunkMarker, true); } }
    this.items.length = 0; this.retained = { raw: 0, purified: 0, ice: 0 }; this.freezeEvents.length = 0; this.world.obstacles.splice(this.initialObstacles); this.physics.clearDynamic(); this.nextId = 1; this.zones.length = 0; this.navigation.rebuild(this.world.obstacles);
  }
  dispose(): void { this.reset(); this.scene.remove(this.group); }
}
