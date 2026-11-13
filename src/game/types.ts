export type GameState = "title" | "playing" | "paused" | "victory" | "gameover";
export type ToolId = "hands" | "shovel" | "brush" | "blower" | "vacuum";
export type BuildingType = "purifier" | "press" | "heater" | "generator" | "sweeper" | "hauler";
export type UpgradeId = "scanner" | "thermal" | "boots";
export type CargoKind = "raw" | "purified" | "ice";
export type Language = "fa" | "en" | "zh";
export type CoreId = "comms" | "habitat" | "command";
export type PausePanel = "menu" | "upgrades" | "settings" | "robots" | "log";
export type RobotZoneMode = "auto" | "follow" | "custom";
export interface ChunkView { id: number; name: string; col: number; row: number; x: number; z: number; size: number; remaining: number; progress: number; assigned: boolean; }
export interface EventEntry { id: number; time: number; text: string; tone: string; kind: "event" | "clue" | "damage" | "power"; key?: string; params?: Record<string, string | number>; }
export type UpgradeLevels = Record<UpgradeId, number>;
export interface ScannerSignal { strength: number; sector: number; band: number; }

export interface ToolDefinition {
  id: ToolId; cost: number; unlockQuest: number;
  radius: number; rate: number; yield: number; distance: number;
}
export const TOOL_CAPACITIES: Record<ToolId, readonly number[]> = {
  hands: [5, 8, 12, 18], shovel: [10, 16, 24, 34], brush: [20, 30, 44, 62],
  blower: [32, 48, 68, 94], vacuum: [48, 70, 100, 140],
};
export const TOOL_UPGRADES: Record<ToolId, readonly number[]> = {
  hands: [24, 55, 110], shovel: [55, 115, 220], brush: [120, 240, 430],
  blower: [220, 410, 690], vacuum: [380, 650, 1050],
};
export const toolRepairCost = (id: ToolId, level: number): number => 18 + TOOLS.findIndex((tool) => tool.id === id) * 16 + Math.max(0, level - 1) * 8;
export const TOOLS: ToolDefinition[] = [
  { id: "hands", cost: 0, unlockQuest: 0, radius: 0.68, rate: 1.85, yield: 0.5, distance: 0.85 },
  { id: "shovel", cost: 45, unlockQuest: 0, radius: 0.86, rate: 2.45, yield: 0.58, distance: 1.05 },
  { id: "brush", cost: 160, unlockQuest: 1, radius: 1.06, rate: 3.05, yield: 0.62, distance: 1.4 },
  { id: "blower", cost: 340, unlockQuest: 3, radius: 1.46, rate: 4.25, yield: 0.68, distance: 1.95 },
  { id: "vacuum", cost: 680, unlockQuest: 6, radius: 2.05, rate: 6.1, yield: 0.76, distance: 4.2 },
];

export interface UpgradeDefinition { id: UpgradeId; costs: [number, number, number]; }
export const UPGRADES: UpgradeDefinition[] = [
  { id: "scanner", costs: [160, 340, 620] },
  { id: "thermal", costs: [140, 310, 560] },
  { id: "boots", costs: [110, 250, 470] },
];

export interface BuildingDefinition {
  cost: number; upgradeCost: number; capacity: number; rate: number;
  radius: number; unlockQuest: number;
}
export const BUILDINGS: Record<BuildingType, BuildingDefinition> = {
  purifier: { cost: 220, upgradeCost: 260, capacity: 80, rate: 1.35, radius: 1.75, unlockQuest: 1 },
  press: { cost: 480, upgradeCost: 440, capacity: 60, rate: 0.4, radius: 1.7, unlockQuest: 4 },
  heater: { cost: 280, upgradeCost: 240, capacity: 0, rate: 0, radius: 0.8, unlockQuest: 8 },
  generator: { cost: 520, upgradeCost: 460, capacity: 0, rate: 0, radius: 1.5, unlockQuest: 7 },
  sweeper: { cost: 780, upgradeCost: 560, capacity: 72, rate: 0, radius: 1.35, unlockQuest: 7 },
  // Internal id retained for save compatibility; presented as search & rescue.
  hauler: { cost: 2200, upgradeCost: 880, capacity: 0, rate: 0, radius: 1.35, unlockQuest: 7 },
};

export type MusicTrack = "quiet-aurora" | "snowglass-drift" | "polar-night" | "none";
export interface SettingsView {
  volume: number; muted: boolean; language: Language; quality: "auto" | "high" | "low"; cameraShake: boolean; particles: boolean; uiScale: number;
  musicTrack: MusicTrack; musicEnabled: boolean; musicVolume: number;
  sfxEnabled: boolean; sfxVolume: number; ambienceEnabled: boolean; ambienceVolume: number;
}
export interface ObjectiveView { x: number; z: number; key: string; distance: number; }
export interface RobotView {
  buildingId: number; slot: number; kind: "sweeper" | "hauler"; x: number; z: number;
  frozen: boolean; temperature: number; thaw: number; health: number; carry: number; capacity: number;
  mode: string; energy: number; zoneAuto: boolean; zoneX: number; zoneZ: number; zoneRange: number;
  zoneMode: RobotZoneMode; chunkQuota: number; activeChunk: number; chunkProgress: number; chunkIds: number[];
  repairAllowed: boolean;
}
export interface BuildView {
  id: number; type: BuildingType; x: number; z: number; level: number; input: number; output: number;
  inputCapacity: number; outputCapacity: number; powered: boolean; near: boolean; progress: number;
  damaged: boolean; repairCost: number; powerSource: string; powerLoad: number; powerCapacity: number; powerEfficiency: number; cableConnected: boolean;
  robotFrozen?: boolean; robotTemperature?: number; robotThaw?: number;
  robotHealth?: number;
  robotCarry?: number; robotCapacity?: number; robotMode?: string; robotRole?: string;
  robots?: RobotView[]; extraRobotCost?: number; generatorRadius?: number; robotServiceCost?: number;
  productionRate?: number; nextProductionRate?: number; productionUnit?: "purified" | "ice";
}
export interface QuestView { index: number; total: number; progress: number; target: number; reward: number; }
export interface ScannerView { strength: number; sector: number; band: number; }
export interface GameSnapshot {
  state: GameState; pausePanel: string | null; language: Language;
  raw: number; purified: number; ice: number; capacity: number; load: number; tankReady: boolean;
  credits: number; heat: number; power: number; cores: number; coreViews: Array<{ id: CoreId; scanned: boolean; revealed: boolean; recovered: boolean }>;
  scannerCooldown: number; scannerCooldownMax: number; scannerRadius: number; scannerSignal: ScannerView;
  radarCharges: number; radarMaxCharges: number; radarBatteryCost: number;
  stormPhase: string; stormTimer: number; stormEta: number; stormCycle: number; stormCount: number; severeStorm: boolean;
  radarActive: boolean; sprinting: boolean; worldSize: number;
  cleanupPercent: number; cleanupCertified: boolean; rawSold: number; salesPerMinute: number; prompt: string; runTime: number; produced: number; sold: number; iceSold: number; speed: number;
  upgrades: Record<UpgradeId, number>; tools: Record<ToolId, number>; toolHealth: Record<ToolId, number>; selectedTool: ToolId;
  muted: boolean; lowQuality: boolean; hasSave: boolean;
  quest: QuestView; objective: ObjectiveView; buildings: BuildView[]; nearestBuilding: BuildView | null;
  buildMode: BuildingType | "rail" | null; railSource: number | null; railCount: number;
  robotCount: number; frozenRobots: number; settings: SettingsView;
  chunks: ChunkView[]; chunkSize: number; chunkColumns: number;
  relays: Array<{ id: "gale" | "servo" | "foundry"; x: number; z: number; cost: number; warmth: number; repaired: boolean; distance: number }>;
  events: EventEntry[]; windX: number; windZ: number;
  cinematic: { active: boolean; time: number; duration: number };
  tutorial: { active: boolean; step: number; total: number; id: string | null };
}
export interface SavedRobot {
  slot: number; x: number; z: number; carry: number; mode: string; returning: boolean;
  sourceId: number; destinationId: number; district: number; health: number;
  temperature: number; frozen: boolean; energy: number; zoneAuto: boolean; zoneX: number; zoneZ: number; zoneRange: number;
  zoneMode?: RobotZoneMode; activeChunk?: number; chunkIds?: number[]; repairAllowed?: boolean;
  rescue?: number; thaw?: number; rescuePaid?: boolean; paymentWait?: number;
}
export interface SavedBuilding {
  id: number; type: BuildingType; x: number; z: number; level: number; input: number; output: number; progress?: number; damaged?: boolean;
  robotTemperature?: number; robotFrozen?: boolean; robotX?: number; robotZ?: number; robotCarry?: number;
  robotMode?: string; robotReturning?: boolean; robotSourceId?: number; robotDestinationId?: number; robotDistrict?: number; robotHealth?: number;
  robots?: SavedRobot[];
}
export interface SaveData {
  version: 11; runTime: number; raw: number; purified: number; ice: number; credits: number; heat: number; power: number;
  rawSold: number; cleanupCertified: boolean;
  radarCharges: number; radarActive: boolean; stormCount: number; nextStormAt: number; nextSevereStorm: number;
  stormPhase: "calm" | "warning" | "storm"; stormTimer: number; severeStorm: boolean;
  recovered: number; produced: number; collectedRaw: number; purifiedSold: number; sold: number; iceSold: number; railDelivered: number; questIndex: number;
  upgrades: Record<UpgradeId, number>; tools: Record<ToolId, number>; toolHealth: Record<ToolId, number>; selectedTool: ToolId;
  salesHistory: Array<{ time: number; amount: number }>;
  player: { x: number; z: number }; snow: number[]; cores: Array<{ id: CoreId; scanned: boolean; revealed: boolean; recovered: boolean }>;
  buildings: SavedBuilding[]; rails: Array<{ sourceId: number; destinationId: number; path: Array<{ x: number; z: number }>; capsules?: Array<{ active: boolean; cargo: number; distance: number; wait: number; travel: number }> }>;
  relays: Array<"gale" | "servo" | "foundry">; events: EventEntry[];
  scannerCooldown: number; status: "playing" | "paused" | "gameover";
  saleCreditRemainder?: number; retainedCargo?: Partial<Record<CargoKind, number>>;
}
export type LegacySave = Omit<SaveData, "version" | "rails" | "upgrades" | "radarCharges" | "radarActive" | "stormCount" | "nextStormAt" | "nextSevereStorm" | "stormPhase" | "stormTimer" | "severeStorm" | "toolHealth" | "salesHistory" | "relays" | "events"> & {
  version: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
  rawSold?: number; cleanupCertified?: boolean;
  scannerCooldown?: number; status?: "playing" | "paused" | "gameover";
  relays?: Array<"gale" | "servo" | "foundry">; events?: EventEntry[];
  radarCharges?: number; radarActive?: boolean; stormCount?: number; nextStormAt?: number; nextSevereStorm?: number;
  stormPhase?: "calm" | "warning" | "storm"; stormTimer?: number; severeStorm?: boolean;
  toolHealth?: Partial<Record<ToolId, number>>; salesHistory?: Array<{ time: number; amount: number }>;
  upgrades: Partial<Record<UpgradeId | "tank", number | boolean>>;
  tools?: Partial<Record<ToolId, number>>;
  rails: Array<{ sourceId: number; destinationId?: number; path: Array<{ x: number; z: number }> }>;
};
export interface DebugApi {
  snapshot: () => GameSnapshot; start: () => void; pause: () => void; resume: () => void; save: () => void;
  teleport: (x: number, z: number) => void; giveCredits: (n: number) => void; setRaw: (n: number) => void;
  setCarried: (pure: number, ice: number) => void; setPower: (n: number) => void; setQuest: (n: number) => void; setRailDelivered: (n: number) => void; scan: () => void; interact: () => void;
  buyTool: (id: ToolId) => void; buyUpgrade: (id: UpgradeId) => void; buyBattery: () => void; selectTool: (id: ToolId) => void; repairTool: (id: ToolId) => boolean; openUpgrades: () => void;
  build: (type: BuildingType, x: number, z: number) => number | undefined; buyBuilding: (type: BuildingType, x: number, z: number) => number | undefined;
  selectBuild: (type: BuildingType) => void; ghostCount: () => number;
  visualState: () => { tools: Record<string, boolean>; footprints: number; activeFootprints: number; stormStreaks: boolean; stormIntensity: number; character: string; facingX: number; facingZ: number; yaw: number };
  buildingVisuals: () => Array<{ id: number; type: BuildingType; level: number; visible: number; meshes: number; baseMeshes: number; damageMeshes: number; damageVisible: boolean; alertState: string; badgeVisible: boolean }>;
  rail: (sourceId: number, destinationId?: number) => boolean; buyRail: (sourceId: number, destinationId?: number) => boolean;
  setOutput: (id: number, n: number) => void; setInput: (id: number, n: number) => void; upgradeNearest: () => void;
  moveBuilding: (id: number, x: number, z: number) => boolean; demolishBuilding: (id: number) => boolean;
  clearAt: (x: number, z: number, r?: number) => number; revealAll: () => void; recoverAll: () => void;
  robotStates: () => Array<{ id: number; buildingId: number; slot: number; kind: "sweeper" | "hauler"; x: number; z: number; frozen: boolean; temperature: number; thaw: number; health: number; carry: number; mode: string; energy: number; zoneAuto: boolean; zoneX: number; zoneZ: number; zoneRange: number; zoneMode: RobotZoneMode; activeChunk: number; chunkIds: number[]; chunkProgress: number; searchRange: number; pathLength: number; pathIndex: number; yaw: number; targetX: number | null; targetZ: number | null; repairAllowed: boolean; paymentWait: number; rescueProgress: number; sourceId: number; destinationId: number }>;
  freezeRobots: () => void; storm: (severe?: boolean) => void; repairBuilding: (id: number) => boolean;
  buyExtraRobot: (buildingId: number) => boolean; setRobotZone: (buildingId: number, slot: number, auto: boolean, x?: number, z?: number, range?: number) => boolean;
  setRobotZoneMode: (buildingId: number, slot: number, mode: RobotZoneMode, chunkId?: number) => boolean; repairRelay: (id: "gale" | "servo" | "foundry") => boolean;
  openLog: () => void; openRobots: () => void; heaterSites: () => Array<{ x: number; z: number }>;
  powerState: () => Array<{ id: number; powered: boolean; source: string; load: number; capacity: number; efficiency: number; cable: boolean; wireMeshes: number }>;
  win: () => void; lose: () => void; step: (seconds: number) => void;
  snowAt: (x: number, z: number) => number; groundAt: (x: number, z: number) => number;
  railState: () => Array<{ sourceId: number; destinationId: number; kind: CargoKind; total: number; cargo: number; corners: number; modernRails: number; oneWayArrows: number; activeCapsules: number; capsules: Array<{ active: boolean; cargo: number; distance: number; waiting: boolean; visible: boolean }> }>;
  stats: () => { fps: number; calls: number; triangles: number; lowQuality: boolean; renderer: string };
  damageBuilding: (id: number) => boolean; setRobotHealth: (id: number, health: number) => void; setRobotEnergy: (id: number, energy: number) => void; setRobotTemperature: (id: number, slot: number, temperature: number, frozen?: boolean) => boolean; setToolHealth: (id: ToolId, health: number) => void;
  audioState: () => { music: string; repair: string; ambience: string; musicLoop: boolean; muted: boolean; musicEnabled: boolean; sfxEnabled: boolean; ambienceEnabled: boolean; musicVolume: number; sfxVolume: number; ambienceVolume: number; track: MusicTrack; context: AudioContextState | "uninitialized"; musicReady: number; musicPaused: boolean; musicTime: number; ambienceReady: number; ambiencePaused: boolean; ambienceTime: number; repairReady: number; repairPaused: boolean; emitted: Partial<Record<"scan" | "pickup" | "deposit" | "upgrade" | "ui" | "warning" | "win" | "lose" | "empty" | "build" | "rail" | "sell" | "robot" | "repair" | "landing", number>> };
  baseVisual: () => { spaceship: boolean; meshes: number };
  cameraState: () => { railMode: boolean; rotationEnabled: boolean; azimuth: number; distance: number };
  toolStats: (id: ToolId, level: number) => { level: number; radius: number; rate: number; yield: number; distance: number; capacity: number; area: number };
  grounding: () => { playerY: number; physicsFootY: number; snowHeight: number; groundHeight: number; soleY: number };
  freezeRobot: (id: number, slot?: number) => boolean; setRepairAllowed: (id: number, slot: number, allowed: boolean) => boolean;
  rescueAt: (x: number, z: number) => "none" | "started" | "active" | "funding";
  setRobotCarry: (id: number, slot: number, carry: number) => boolean;
  logistics: () => { retained: Record<CargoKind, number>; saleRemainder: number; buildings: Array<{ id: number; type: BuildingType; output: number; input: number; outputCapacity: number; inputCapacity: number; damaged: boolean }> };
  qualityDecision: (state: { low: boolean; lowStreak: number; highStreak: number; hold: number }, sample: { fps: number; hidden: boolean; locked: boolean }) => { low: boolean; lowStreak: number; highStreak: number; hold: number };
  applyFpsSample: (fps: number, hidden?: boolean) => { lowQuality: boolean; lowStreak: number; highStreak: number; hold: number };
}
declare global { interface Window { __whiteoutDebug?: DebugApi; } }
