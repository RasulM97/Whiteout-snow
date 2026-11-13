import * as THREE from "three";
import { BUILDINGS, type BuildingType, type BuildView, type CargoKind, type RobotZoneMode, type SavedBuilding } from "./types";
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
}
export interface RobotEntity {
  kind: "sweeper" | "hauler"; slot: number; group: THREE.Group; visual: THREE.Group; motionRig: THREE.Group; frost: THREE.Mesh;
  target: THREE.Vector3 | null; carry: number; returning: boolean; timer: number;
  sourceId: number; destinationId: number; temperature: number; frozen: boolean; thaw: number; rescue: number;
  moving: boolean; working: boolean; district: number; mode: string; health: number;
  energy: number; zoneAuto: boolean; zoneX: number; zoneZ: number; zoneRange: number; assisted: boolean;
  zoneMode: RobotZoneMode; activeChunk: number; chunkIds: number[]; searchRange: number; chunkProgress: number;
  path: NavPoint[]; pathIndex: number; pathGoal: NavPoint; navVersion: number; repath: number; stuck: number; lastX: number; lastZ: number;
  chunkMarker: THREE.LineLoop;
  repairAllowed: boolean; paymentWait: number; rescuePaid: boolean;
}
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
  private time = 0;
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
  private updateStatusBadge(b: BuildingEntity): void {
    const kind = b.damaged ? "damage" : !b.powered ? "power" : (b.type === "purifier" || b.type === "press") && b.input < 0.05 && b.progress <= 0 ? "input" : "";
    const badge = b.statusBadge; badge.visible = !!kind;
    if (badge.visible) badge.scale.setScalar(1.12 + Math.sin(this.time * 4 + b.id) * 0.08);
    if (kind === b.alertState) return;
    const previous = b.alertState; b.alertState = kind;
    if (!kind) return;
    const canvas = badge.userData.canvas as HTMLCanvasElement; const ctx = canvas.getContext("2d")!; ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = "rgba(9,28,35,.94)"; ctx.strokeStyle = kind === "damage" ? "#ff735c" : kind === "power" ? "#ffd36b" : "#86e6ef"; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(64, 64, 52, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = ctx.fillStyle = kind === "damage" ? "#ff8a69" : kind === "power" ? "#ffe08a" : "#a8f4f4"; ctx.lineWidth = 9; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (kind === "power") {
      ctx.beginPath(); ctx.moveTo(70, 25); ctx.lineTo(43, 67); ctx.lineTo(62, 67); ctx.lineTo(52, 103); ctx.lineTo(87, 55); ctx.lineTo(66, 55); ctx.closePath(); ctx.fill();
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
    if (type === "generator" && Math.abs(x - GAME.baseCenter.x) + Math.abs(z - GAME.baseCenter.z) > GAME.generatorCableRange) return null;
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
    };
    this.createDamageVisual(b); this.createPowerWire(b); createLevelDetails(b); this.items.push(b);
    if (type === "purifier") void this.models.attach(group, "purifier", 3.1, fallback).then((placed) => { if (placed) moving.visible = false; });
    if (type === "press") void this.models.attach(group, "ice-press", 3.15, fallback).then((placed) => { if (placed) moving.visible = false; });
    if (type === "sweeper" || type === "hauler") { this.spawnRobot(b); if (!restored) this.hooks.robot(); }
    this.refreshHeaterZones(); this.navigation.rebuild(this.world.obstacles);
    return b;
  }

  private spawnRobot(b: BuildingEntity, slot = b.robots.length): RobotEntity {
    const group = new THREE.Group(); const visual = new THREE.Group(); const motionRig = new THREE.Group(); group.add(visual, motionRig); this.group.add(group);
    const kind = b.type as "sweeper" | "hauler";
    if (kind === "sweeper") {
      for (const x of [-0.55, 0.55]) mesh(new THREE.BoxGeometry(0.38, 0.42, 1.35), mats.rubber, visual, x, 0.38);
      mesh(new THREE.BoxGeometry(1.25, 0.75, 1.15), mats.orange, visual, 0, 0.8);
      mesh(new THREE.BoxGeometry(0.7, 0.22, 0.08), mats.cyan, visual, 0, 0.92, 0.59);
      const brush = mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.45, 12), mats.dark, motionRig, 0, 0.38, 0.95); brush.rotation.z = Math.PI / 2;
    } else {
      // New search-and-rescue unit: a forward-facing aerial medic/welder, not the old cargo rover.
      const body = mesh(new THREE.SphereGeometry(0.72, 18, 12), mats.cream, visual, 0, 1.15); body.scale.set(1, 0.58, 1.25);
      mesh(new THREE.BoxGeometry(0.72, 0.2, 0.12), mats.cyan, visual, 0, 1.18, 0.83);
      mesh(new THREE.ConeGeometry(0.22, 0.65, 8), mats.orange, visual, 0, 0.75, 0.62).rotation.x = Math.PI;
      for (const side of [-1, 1]) {
        mesh(new THREE.BoxGeometry(1.25, 0.12, 0.16), mats.dark, visual, side * 0.75, 1.18, 0);
        for (const z of [-0.62, 0.62]) {
          const rotor = mesh(new THREE.TorusGeometry(0.37, 0.065, 8, 20), mats.cyan, visual, side * 1.12, 1.25, z); rotor.rotation.x = Math.PI / 2;
          const blade = mesh(new THREE.BoxGeometry(0.65, 0.035, 0.08), mats.dark, motionRig, side * 1.12, 1.26, z); blade.userData.rotor = true;
        }
      }
      const welder = mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.8, 8), mats.orange, motionRig, 0, 0.68, 0.72); welder.rotation.x = -0.4; welder.userData.welder = true;
    }
    const frost = mesh(new THREE.IcosahedronGeometry(1.05, 1), new THREE.MeshBasicMaterial({ color: 0x9eeeff, transparent: true, opacity: 0.35, wireframe: true, depthWrite: false }), group, 0, 0.85);
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
      path: [], pathIndex: 0, pathGoal: { x: Number.NaN, z: Number.NaN }, navVersion: this.navigation.version,
      repath: 0, stuck: 0, lastX: group.position.x, lastZ: group.position.z, chunkMarker,
      repairAllowed: true, paymentWait: 0, rescuePaid: false,
    };
    b.robots.push(robot); if (!b.robot) b.robot = robot; return robot;
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
    r.searchRange = 12 + b.level * 4; r.path = []; r.navVersion = -1;
    if (mode === "custom") {
      if (Number.isFinite(x)) r.zoneX = THREE.MathUtils.clamp(x!, -GAME.worldLimit, GAME.worldLimit);
      if (Number.isFinite(z)) r.zoneZ = THREE.MathUtils.clamp(z!, -GAME.worldLimit, GAME.worldLimit);
    } else if (mode === "auto") { r.zoneX = b.x; r.zoneZ = b.z; }
    if (Number.isFinite(range)) r.searchRange = THREE.MathUtils.clamp(range!, 8, GAME.worldSize);
    r.zoneRange = r.searchRange; return true;
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

  private findSweeperTarget(b: BuildingEntity, r: RobotEntity, snow: SnowField): THREE.Vector3 | null {
    const x = r.zoneMode === "auto" ? b.x : r.zoneX; const z = r.zoneMode === "auto" ? b.z : r.zoneZ;
    const reserved = new Set<number>();
    for (const building of this.items) for (const other of building.robots) if (other !== r && other.kind === "sweeper") {
      if (other.activeChunk >= 0) reserved.add(other.activeChunk); for (const id of other.chunkIds) reserved.add(id);
    }
    if (r.activeChunk >= 0 && snow.chunkView(r.activeChunk).remaining < 0.55) {
      r.chunkIds = r.chunkIds.filter((id) => id !== r.activeChunk); r.activeChunk = -1;
    }
    r.chunkIds = r.chunkIds.filter((id) => snow.chunkView(id).remaining >= 0.55);
    const quota = this.chunkQuota(b);
    while (r.chunkIds.length < quota) {
      const fromX = r.activeChunk >= 0 ? snow.chunkCenter(r.activeChunk).x : r.group.position.x;
      const fromZ = r.activeChunk >= 0 ? snow.chunkCenter(r.activeChunk).z : r.group.position.z;
      const found = snow.findBestChunk(x, z, r.searchRange, [...reserved, ...r.chunkIds], fromX, fromZ);
      if (found === null) {
        if (r.searchRange < GAME.worldSize) { r.searchRange = Math.min(GAME.worldSize, r.searchRange + snow.chunkSize); r.zoneRange = r.searchRange; continue; }
        break;
      }
      r.chunkIds.push(found); reserved.add(found);
    }
    if (r.activeChunk < 0 || !r.chunkIds.includes(r.activeChunk)) {
      r.activeChunk = r.chunkIds.sort((a, c) => {
        const ca = snow.chunkCenter(a), cc = snow.chunkCenter(c);
        return Math.hypot(ca.x - r.group.position.x, ca.z - r.group.position.z) - Math.hypot(cc.x - r.group.position.x, cc.z - r.group.position.z);
      })[0] ?? -1;
    }
    r.chunkProgress = r.activeChunk >= 0 ? snow.chunkView(r.activeChunk).progress : 0;
    this.updateChunkMarker(r, snow);
    if (r.activeChunk < 0) return null;
    const found = snow.findChunkTarget(r.activeChunk, r.group.position.x, r.group.position.z);
    if (found) return new THREE.Vector3(found.x, 0, found.z);
    const depleted = r.activeChunk;
    r.chunkIds = r.chunkIds.filter((id) => id !== depleted); r.activeChunk = -1;
    const replacement = snow.findBestChunk(x, z, r.searchRange, [...reserved, ...r.chunkIds, depleted], r.group.position.x, r.group.position.z);
    if (replacement !== null) { r.chunkIds.push(replacement); r.activeChunk = replacement; const next = snow.findChunkTarget(replacement, r.group.position.x, r.group.position.z); if (next) return new THREE.Vector3(next.x, 0, next.z); }
    return null;
  }

  private updateSweeper(b: BuildingEntity, r: RobotEntity, snow: SnowField, dt: number, player?: { x: number; z: number }): void {
    if (r.zoneMode === "follow" && player) { r.zoneX = player.x; r.zoneZ = player.z; }
    const efficiency = Math.max(0.55, b.powerEfficiency);
    const speed = (5.8 + b.level * 0.95) * efficiency * this.relayBoosts.sweeper * (r.temperature < 30 ? 0.72 : 1);
    const capacity = 20 + b.level * 6;
    r.timer -= dt; r.working = false;
    if (r.returning) {
      r.mode = "return";
      this.moveTarget.set(b.x + 2.25, 0, b.z);
      if (this.moveRobot(r, this.moveTarget, speed, dt) < 2.15) {
        r.mode = "unload";
        const accepted = Math.min(r.carry, Math.max(0, this.outputCapacity(b) - b.output));
        b.output += accepted; r.carry -= accepted; r.working = accepted > 0; b.activity = Math.max(b.activity, 0.8);
        if (r.carry <= 0.01) { r.carry = 0; r.returning = false; r.target = null; r.timer = 0; r.mode = "seek"; r.working = false; }
      }
      return;
    }
    if (!r.target || snow.sample(r.target.x, r.target.z) < 0.06) {
      r.mode = "seek"; r.target = this.findSweeperTarget(b, r, snow); r.timer = 0.55;
    }
    if (!r.target) {
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
      if (r.carry >= capacity - 0.01) { r.returning = true; r.target = null; r.mode = "return"; }
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

  private refreshPowerGrid(): void {
    interface Source { key: string; x: number; z: number; radius: number; capacity: number; load: number; generator?: BuildingEntity }
    const sources: Source[] = [{ key: "base", x: GAME.baseCenter.x, z: GAME.baseCenter.z, radius: GAME.basePowerRadius, capacity: GAME.basePowerConnections, load: 0 }];
    for (const generator of this.items.filter((b) => b.type === "generator")) {
      generator.cableConnected = Math.abs(generator.x - GAME.baseCenter.x) + Math.abs(generator.z - GAME.baseCenter.z) <= GAME.generatorCableRange;
      generator.powered = generator.cableConnected && !generator.damaged;
      generator.powerSource = generator.cableConnected ? "base" : "none";
      generator.powerLoad = 0; generator.powerCapacity = 3 + generator.level - 1; generator.powerEfficiency = 0;
      if (generator.powered) sources.push({ key: `generator:${generator.id}`, x: generator.x, z: generator.z, radius: generatorRadius(generator.level), capacity: 3 + generator.level - 1, load: 0, generator });
    }
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
  outputCapacity(b: BuildingEntity): number { return b.type === "press" ? 20 + (b.level - 1) * 10 : b.type === "hauler" ? 0 : this.capacity(b); }
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
  warmingAt(x: number, z: number): boolean {
    if (Math.hypot(x - GAME.baseCenter.x, z - GAME.baseCenter.z) < GAME.baseHeatRadius) return true;
    for (const zone of this.protectedZones()) if (Math.hypot(x - zone.x, z - zone.z) < zone.r) return true;
    return false;
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
        this.updateRobotThermal(r, dt, storm, rescuer); this.animateRobot(b, r, dt);
      }
      if (!b.powered || b.damaged) continue;
      if (b.type === "purifier") {
        const room = Math.max(0, this.capacity(b) - b.output);
        const amount = Math.min(b.input, room / 0.85, BUILDINGS.purifier.rate * (1 + (b.level - 1) * 0.9) * this.relayBoosts.production * Math.max(0.5, b.powerEfficiency) * dt);
        if (amount > 0) { b.input -= amount; const made = amount * 0.85; b.output += made; b.activity = Math.max(b.activity, 0.28); this.hooks.produced(made); }
      } else if (b.type === "press") {
        // Reserve a complete batch once. Partial rail deliveries can then accumulate
        // without resetting work or reporting a false missing-input warning.
        if (b.progress <= 0 && b.input >= 5 && b.output < this.outputCapacity(b)) { b.input -= 5; b.progress = 0.0001; }
        if (b.progress > 0 && b.output < this.outputCapacity(b)) {
          b.progress += dt * (1 + (b.level - 1) * 0.9) * this.relayBoosts.production * Math.max(0.5, b.powerEfficiency);
          if (b.progress >= 2.4) { b.progress = 0; b.output += 1; b.activity = 1; }
        }
      } else if (b.type === "sweeper") {
        for (const r of b.robots) if (!r.frozen && r.health > 0) this.updateSweeper(b, r, snow, dt, player);
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
        zoneRange: r.zoneRange, zoneMode: r.zoneMode, chunkQuota: this.chunkQuota(b), activeChunk: r.activeChunk,
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
        productionRate: b.type === "purifier" ? BUILDINGS.purifier.rate * (1 + (b.level - 1) * 0.9) * this.relayBoosts.production * Math.max(0.5, b.powerEfficiency) * 0.85 : b.type === "press" ? 60 / 2.4 * (1 + (b.level - 1) * 0.9) * this.relayBoosts.production * Math.max(0.5, b.powerEfficiency) : undefined,
        nextProductionRate: b.level < 3 && b.type === "purifier" ? BUILDINGS.purifier.rate * (1 + b.level * 0.9) * this.relayBoosts.production * Math.max(0.5, b.powerEfficiency) * 0.85 : b.level < 3 && b.type === "press" ? 60 / 2.4 * (1 + b.level * 0.9) * this.relayBoosts.production * Math.max(0.5, b.powerEfficiency) : undefined,
        productionUnit: b.type === "purifier" ? "purified" : b.type === "press" ? "ice" : undefined,
      };
    });
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
    if (b.type === "generator" && Math.abs(x - GAME.baseCenter.x) + Math.abs(z - GAME.baseCenter.z) > GAME.generatorCableRange) return false;
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
        r.zoneMode = data?.zoneMode ?? (r.zoneAuto ? "auto" : "custom"); r.zoneAuto = r.zoneMode === "auto";
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
    this.items.length = 0; this.retained = { raw: 0, purified: 0, ice: 0 }; this.world.obstacles.splice(this.initialObstacles); this.physics.clearDynamic(); this.nextId = 1; this.zones.length = 0; this.navigation.rebuild(this.world.obstacles);
  }
  dispose(): void { this.reset(); this.scene.remove(this.group); }
}
