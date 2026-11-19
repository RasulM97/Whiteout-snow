import * as THREE from "three";
import { GameLoop } from "./engine";
import { Input } from "./input";
import { GameStateMachine } from "./state";
import { AudioSystem } from "./audio";
import { GAME, COLORS, QUALITY } from "./config";
import { SnowField, groundHeight } from "./snow";
import { World, createPlayer, attachEngineer, type CoreEntity } from "./world";
import { Effects } from "./effects";
import { GameUI } from "./ui";
import { storage } from "./storage";
import { BUILDINGS, TOOLS, TOOL_CAPACITIES, TOOL_UPGRADES, UPGRADES, toolRepairCost, type BuildingType, type CargoKind, type EventEntry, type GameSnapshot, type LegacySave, type ObjectiveView, type PausePanel, type RobotZoneMode, type SaveData, type ScannerSignal, type SettingsView, type ToolId, type UpgradeId, type UpgradeLevels } from "./types";
import { ModelLibrary } from "./models";
import { BuildingSystem, workAreaRadius } from "./buildings";
import { RailSystem, type RailPathPoint } from "./rails";
import type { NetEnd, NetPolicy, NetResult, NetSave, StrokeView } from "./rail-network";
import { QUESTS } from "./quests";
import { locale, translate } from "./i18n";
import { PhysicsSystem } from "./physics";
import { RelaySystem, type RelayId } from "./relays";
import { CharacterAnimator } from "./character";
import CameraControls from "camera-controls";
import { toolClearRate, toolTierStats } from "./tool-progression";
import { OpeningCinematic } from "./cinematic";
import { InterfaceTutorial } from "./tutorial";
import { disposeObject } from "./resources";

declare global {
  interface Window {
    __gameProbe?: () => { x: number; y: number; z: number };
    __GAME_READY__?: boolean;
  }
}
let session: { dispose: () => void } | null = null;
const blankUpgrades = (): UpgradeLevels => ({ scanner: 0, thermal: 0, boots: 0 });
const blankTools = (): Record<ToolId, number> => ({ hands: 1, shovel: 0, brush: 0, blower: 0, vacuum: 0 });
const fullToolHealth = (): Record<ToolId, number> => ({ hands: 100, shovel: 100, brush: 100, blower: 100, vacuum: 100 });
const defaultSettings = (): SettingsView => ({
  language: "en", quality: "auto", volume: 0.7, muted: false, cameraShake: true, particles: true, uiScale: 1,
  musicTrack: "quiet-aurora", musicEnabled: true, musicVolume: 0.55,
  sfxEnabled: true, sfxVolume: 0.7, ambienceEnabled: true, ambienceVolume: 0.55,
});
const lerpAngle = (a: number, b: number, t: number): number => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const mulberry32 = (seed: number): (() => number) => () => {
  seed |= 0; seed = seed + 0x6d2b79f5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

interface QualityLatch { low: boolean; lowStreak: number; highStreak: number; hold: number }
interface QualitySample { fps: number; hidden: boolean; locked: boolean }

/** Drop quality only after repeated foreground stalls, and restore it only after a sustained recovery. */
function advanceQualityLatch(state: QualityLatch, sample: QualitySample): QualityLatch {
  if (sample.locked || sample.hidden || !Number.isFinite(sample.fps)) return { low: state.low, lowStreak: 0, highStreak: 0, hold: sample.locked ? 0 : state.hold };
  const hold = Math.max(0, state.hold - 1);
  if (hold > 0) return { low: state.low, lowStreak: 0, highStreak: 0, hold };
  if (!state.low && sample.fps < QUALITY.DEGRADE_FPS) {
    const lowStreak = state.lowStreak + 1;
    return lowStreak >= 3 ? { low: true, lowStreak: 0, highStreak: 0, hold: 4 } : { low: false, lowStreak, highStreak: 0, hold: 0 };
  }
  if (state.low && sample.fps >= QUALITY.RESTORE_FPS) {
    const highStreak = state.highStreak + 1;
    return highStreak >= 4 ? { low: false, lowStreak: 0, highStreak: 0, hold: 4 } : { low: true, lowStreak: 0, highStreak, hold: 0 };
  }
  return { low: state.low, lowStreak: 0, highStreak: 0, hold: 0 };
}

class WhiteoutGame {
  private renderer: THREE.WebGLRenderer; private scene = new THREE.Scene(); private camera: THREE.PerspectiveCamera;
  private models = new ModelLibrary(); private world: World; private relays: RelaySystem; private snow: SnowField; private physics: PhysicsSystem; private player = createPlayer();
  private character = new CharacterAnimator(this.player); private cameraControls: CameraControls;
  private effects: Effects; private input: Input; private audio = new AudioSystem(); private ui: GameUI;
  private buildings: BuildingSystem; private rails: RailSystem;
  private cinematic: OpeningCinematic; private tutorial: InterfaceTutorial;
  private state = new GameStateMachine(); private loop: GameLoop;
  private raycaster = new THREE.Raycaster(); private pointer = new THREE.Vector2(); private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private aimPoint = new THREE.Vector3(); private brushPoint = new THREE.Vector3(); private facing = new THREE.Vector3(0, 0, -1);
  private previousPose = { position: new THREE.Vector3(GAME.spawn.x, 0, GAME.spawn.z), yaw: Math.PI };
  private currentPose = { position: new THREE.Vector3(GAME.spawn.x, 0, GAME.spawn.z), yaw: Math.PI };
  private renderPosition = new THREE.Vector3();
  private desiredCamera = new THREE.Vector3(24, 23, 29); private cameraTarget = new THREE.Vector3(0, 0, 8); private currentTarget = new THREE.Vector3(0, 0, 8);
  private sun: THREE.DirectionalLight; private fog: THREE.Fog;
  private settings: SettingsView = { ...defaultSettings(), ...storage.get<Partial<SettingsView>>("settings-v2", {}) };
  private upgrades = blankUpgrades(); private tools = blankTools(); private selectedTool: ToolId = "hands"; private debugClear = false;
  private toolHealth: Record<ToolId, number> = fullToolHealth();
  private salesHistory: Array<{ time: number; amount: number }> = [];
  private pausePanel: PausePanel = "menu"; private settingsReturnToPause = false; private raw = 0; private purified = 0; private ice = 0;
  private credits = 0; private heat = 100; private power = 15; private recovered = 0; private produced = 0;
  private collectedRaw = 0; private purifiedSold = 0; private iceSold = 0; private sold = 0; private rawSold = 0; private railDelivered = 0;
  private cleanupCertified = false;
  private questIndex = 0; private runTime = 0; private visualTime = 0; private walkTime = 0; private scannerCooldown = 0;
  private radarCharges = 3; private readonly radarMaxCharges = 5; private readonly radarBatteryCost = 55;
  private scannerSignal: ScannerSignal = { strength: 0, sector: 0, band: 0 }; private signalAge = 99;
  private stormPhase: "calm" | "warning" | "storm" = "calm"; private stormTimer = 0; private stormIntensity = 0;
  private nextStormAt: number = GAME.firstStormAt; private stormCount = 0; private nextSevereStorm = 6; private severeStorm = false;
  private random = mulberry32(GAME.seed + 991); private radarActive = false; private sprinting = false; private forceNextSevere = false;
  private prompt = ""; private uiTimer = 0; private saveTimer = 0;
  private hasSave = false; private lowQuality = false; private fpsFrames = 0; private fpsElapsed = 0; private measuredFps = 60;
  private fpsLowStreak = 0; private fpsHighStreak = 0; private qualityHold = 0; private tabHidden = false; private saleRemainder = 0;
  private gpuName = "unknown"; private lastFrameTime = performance.now(); private disposed = false; private cameraZoom = 1;
  private cameraAzimuth = Math.atan2(14, 18);
  private buildMode: BuildingType | "rail" | null = null; private railSource: number | null = null; private relocating: number | null = null;
  private workDock: number | null = null; private workPoint: { x: number; z: number } | null = null; private workLocked = false; private workRing!: THREE.Mesh;
  private railDraft: { sourceId: number; destinationId: number; controls: RailPathPoint[]; lane: number; paid: number; existing: boolean; selected: number | null } | null = null;
  private networkDraft: { from: NetEnd; to: NetEnd; points: RailPathPoint[]; valid: boolean; cost: number; kind: CargoKind; sourceName: string; destinationName: string } | null = null;
  private strokePlan: StrokeView | null = null;
  private strokeRaw: RailPathPoint[] | null = null;
  private stroke: RailPathPoint[] | null = null;
  private strokeWasDown = false;
  private drawArmed = true;
  private editMode = false;
  private anchor: RailPathPoint | null = null;
  private selectedEdgeId: number | null = null;
  private junctionArm: "merge" | "split" | null = null;
  private selectedJunction: number | null = null;
  private sharedArm = false;
  private railDrag: { index: number; moved: boolean; wasSelected: boolean } | null = null;
  private railHandles = new THREE.Group();
  private ghost = new THREE.Group(); private railPreview: THREE.Line; private buildCursor: { x: number; z: number } | null = null;
  private shakeStrength = 0; private interactionAnim = 0; private stepDistance = 0; private footSide = 1; private lastFrozenCount = 0; private heatWarningArmed = true;
  private onResize = () => this.resize();
  private onVisibility = () => { this.tabHidden = document.hidden; if (document.hidden && this.state.is("playing")) this.pause(); };
  private events: EventEntry[] = []; private nextEventId = 1; private alertTimes = new Map<string, number>();
  private migrationRadarRefund = false;

  constructor(private canvas: HTMLCanvasElement, overlay: HTMLElement) {
    const coarse = matchMedia("(pointer: coarse)").matches || innerWidth < 760; const params = new URLSearchParams(location.search);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.settings.quality !== "low", preserveDrawingBuffer: true, powerPreference: "high-performance" });
    const gl = this.renderer.getContext(); const gpuInfo = gl.getExtension("WEBGL_debug_renderer_info");
    this.gpuName = gpuInfo ? String(gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    this.lowQuality = this.settings.quality === "low" || (this.settings.quality === "auto" && (params.has("low") || /swiftshader|llvmpipe|software/i.test(this.gpuName)));
    this.renderer.setSize(innerWidth, innerHeight, false); this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.12;
    this.scene.background = new THREE.Color(COLORS.sky); this.fog = new THREE.Fog(COLORS.fog, 48, 132); this.scene.fog = this.fog;
    this.camera = new THREE.PerspectiveCamera(coarse ? 52 : 46, innerWidth / innerHeight, 0.1, 360); this.camera.position.copy(this.desiredCamera);
    CameraControls.install({ THREE });
    this.cameraControls = new CameraControls(this.camera, canvas);
    this.cameraControls.mouseButtons.left = CameraControls.ACTION.NONE; this.cameraControls.mouseButtons.right = CameraControls.ACTION.NONE;
    this.cameraControls.mouseButtons.wheel = CameraControls.ACTION.NONE; this.cameraControls.touches.one = CameraControls.ACTION.NONE;
    this.cameraControls.smoothTime = 0.12; this.cameraControls.draggingSmoothTime = 0.12;
    this.scene.add(new THREE.HemisphereLight(0xc7e9ed, 0x19353d, 1.65));
    this.sun = new THREE.DirectionalLight(0xf0f4e9, 2.35); this.sun.position.set(-24, 35, 20);
    this.sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048); this.sun.shadow.camera.left = -42; this.sun.shadow.camera.right = 42;
    this.sun.shadow.camera.top = 42; this.sun.shadow.camera.bottom = -42; this.sun.shadow.camera.near = 2; this.sun.shadow.camera.far = 100; this.sun.shadow.bias = -0.00025; this.scene.add(this.sun);
    const rim = new THREE.DirectionalLight(0x60bac3, 0.8); rim.position.set(25, 16, -30); this.scene.add(rim);
    this.world = new World(this.scene); this.relays = new RelaySystem(this.scene);
    for (const relay of this.relays.items) this.world.obstacles.push({ x: relay.x, z: relay.z, r: 2.25 });
    this.snow = new SnowField(this.scene, this.world.obstacles); this.physics = new PhysicsSystem(this.world.obstacles); this.scene.add(this.player.group);
    this.effects = new Effects(this.scene);
    this.audio.setVolume(this.settings.volume);
    this.audio.setMusicTrack(this.settings.musicTrack); this.audio.setMusicEnabled(this.settings.musicEnabled); this.audio.setMusicVolume(this.settings.musicVolume);
    this.audio.setSfxEnabled(this.settings.sfxEnabled); this.audio.setSfxVolume(this.settings.sfxVolume);
    this.audio.setAmbienceEnabled(this.settings.ambienceEnabled); this.audio.setAmbienceVolume(this.settings.ambienceVolume);
    this.buildings = new BuildingSystem(this.scene, this.world, this.models, this.physics, {
      produced: (amount) => { this.produced += amount; }, power: (amount) => { this.power = Math.min(100, this.power + amount); },
      robot: () => { this.audio.sfx("robot"); this.ui.notify(this.t("toast.robot"), "warm"); },
      frozen: () => { this.audio.sfx("warning"); this.recordEvent(this.t("toast.robotFrozen"), "danger", "event"); },
      alert: (b, kind) => {
        const key = `${b.id}:${kind}`; const last = this.alertTimes.get(key) ?? -999;
        if (kind !== "damage" && this.runTime - last < 45) return;
        this.alertTimes.set(key, this.runTime);
        this.recordEvent(`${this.t(`building.${b.type}.name`)} #${b.id} · ${this.t(`alert.${kind}`)}`, kind === "power" ? "warm" : "danger", kind === "damage" ? "damage" : kind === "power" ? "power" : "event", `alert.${kind}`, { buildingType: b.type, buildingId: b.id });
        if (kind === "damage") this.audio.sfx("warning");
      },
      repaired: (b) => { this.recordEvent(`${this.t(`building.${b.type}.name`)} #${b.id} · ${this.t("toast.rescueRepaired")}`, "warm", "event"); this.audio.sfx("repair"); },
      charge: (cost, reason) => {
        if (!this.charge(cost)) { this.ui.notify(this.t("toast.noCredits"), "warm"); return false; }
        this.recordEvent(`${this.t(`toast.charge.${reason}`)} · −${cost} ◈`, "warm", "event");
        return true;
      },
    });
    this.rails = new RailSystem(
      this.scene,
      this.buildings,
      (kind, amount, byRail) => this.sell(kind, amount, byRail),
      (_kind, amount) => {
        this.railDelivered += amount;
        this.updateQuest();
      },
    );
    this.ui = new GameUI(overlay, {
      start: () => this.startRun(), continue: () => this.continueRun(), resume: () => this.resume(), restart: () => this.startRun(), checkpoint: () => this.recoverCheckpoint(), pause: () => this.pause(),
      openUpgrades: () => this.openUpgrades(), openSettings: () => this.openSettings(), openRobots: () => this.openRobots(), openLog: () => this.openLog(), closePanel: () => this.closePanel(), mute: () => this.toggleMute(), tutorial: () => this.openTutorial(),
      scan: () => this.scan(), interact: () => this.interact(), buyUpgrade: (id) => this.buyUpgrade(id), buyBattery: () => this.buyBattery(), buyTool: (id) => this.buyTool(id), selectTool: (id) => this.selectTool(id), repairTool: (id) => this.repairTool(id),
      selectBuild: (type) => this.selectBuild(type), selectRail: () => this.selectRail(), confirmRail: () => this.confirmRailDraft(), cancelRail: () => this.cancelRailDraft(), removeRailPoint: () => this.removeRailPoint(), upgradeBuilding: () => this.upgradeNearest(),
      armDraw: () => { this.drawArmed = true; this.editMode = false; this.audio.sfx("ui"); this.updateUI(); },
      editRail: () => this.beginRailEdit(),
      extendRail: () => this.beginRailExtend(),
      deleteRail: () => this.deleteSelectedRail(),
      setJunctionPolicy: (policy, ratio) => { if (this.selectedJunction != null && this.rails.network.policy(this.selectedJunction, policy, ratio)) { this.saveGame(); this.updateUI(); } },
      moveBuilding: () => this.moveNearest(), demolishBuilding: () => this.demolishNearest(), repairBuilding: () => this.repairNearest(),
      beginWorkArea: () => this.beginWorkArea(), confirmWorkArea: () => this.confirmWorkArea(), cancelWorkArea: () => this.cancelWorkArea(), clearWorkArea: () => this.clearNearestWorkArea(),
      buyExtraRobot: (buildingId) => { this.buyExtraRobot(buildingId); },
      robotZoneMode: (buildingId, slot, mode, chunkId) => { this.setRobotZoneMode(buildingId, slot, mode, chunkId); },
      robotRepairAllowed: (buildingId, slot, allowed) => { this.buildings.setRepairAllowed(buildingId, slot, allowed); this.saveGame(); this.updateUI(); },
      setting: (key, value) => this.updateSetting(key, value),
    });
    this.input = new Input(canvas); this.ui.applyLanguage(this.settings.language); this.world.setLanguage(this.settings.language);
    this.tutorial = new InterfaceTutorial(overlay, (key) => this.t(key), () => this.audio.sfx("ui"));
    this.cinematic = new OpeningCinematic({
      overlay, scene: this.scene, ship: this.world.group.getObjectByName("main-spaceship-base")!, player: this.player.group,
      translate: (key) => this.t(key), sfx: (id) => this.audio.sfx(id),
      snowHeight: (x, z) => this.snow.heightAt(x, z), animate: (dt, moving) => this.character.update(dt, moving, false),
      onFinished: () => {
        this.player.group.position.set(GAME.spawn.x, this.snow.heightAt(GAME.spawn.x, GAME.spawn.z), GAME.spawn.z);
        this.physics.reset(GAME.spawn.x, GAME.spawn.z);
        if (this.tutorial.shouldAutoStart()) this.tutorial.start();
        this.input.resetAll(); this.updateUI();
      },
    });
    this.ghost.visible = false; this.scene.add(this.ghost);
    const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(96 * 3), 3));
    this.railPreview = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: COLORS.orange, transparent: true, opacity: 0.95, dashSize: 0.4, gapSize: 0.28, depthTest: false })); this.railPreview.renderOrder = 6; this.railPreview.frustumCulled = false; this.railPreview.visible = false; this.scene.add(this.railPreview);
    this.workRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), new THREE.MeshBasicMaterial({ color: 0x7dffe8, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false }));
    this.workRing.rotation.x = -Math.PI / 2; this.workRing.visible = false; this.workRing.renderOrder = 6; this.scene.add(this.workRing);
    this.railHandles.visible = false; this.scene.add(this.railHandles);
    for (let i = 0; i < 10; i++) {
      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffc56a, transparent: true, opacity: 0.95, depthTest: false }));
      handle.visible = false; handle.renderOrder = 6; this.railHandles.add(handle);
    }
    this.state.onChange((next) => {
      this.audio.setClearing(false); this.ui.showState(next, this.pausePanel);
      if (next === "victory" || next === "gameover") this.ui.showEnd(next === "victory", this.snapshot());
    });
    this.hasSave = !!this.readSave(); this.resetRun(); this.ui.showState("title"); this.updateUI(); this.applyQuality();
    window.addEventListener("resize", this.onResize); document.addEventListener("visibilitychange", this.onVisibility);
    window.__gameProbe = () => ({ x: this.player.group.position.x, y: this.player.group.position.y, z: this.player.group.position.z });
    this.installDebug(); this.loop = new GameLoop({ update: (dt) => this.update(dt), render: (alpha) => this.render(alpha) }); this.loop.start();
    attachEngineer(this.models, this.player);
    const grant = readLaunchCreditGrant();
    if (grant != null) {
      if (this.hasSave) this.continueRun();
      else this.startRun(false);
      this.credits = grant;
      this.updateUI();
      this.saveGame();
    }
  }

  private t(key: string): string { return translate(this.settings.language, key); }
  private recordEvent(text: string, tone: "info" | "warm" | "danger" = "info", kind: EventEntry["kind"] = "event", key?: string, params?: Record<string, string | number>): void {
    this.events.push({ id: this.nextEventId++, time: this.runTime, text, tone, kind, key, params });
    // Story evidence is never evicted by recurring machine warnings.
    const clues = this.events.filter((event) => event.kind === "clue");
    const operational = this.events.filter((event) => event.kind !== "clue").slice(-80);
    this.events = [...operational, ...clues].sort((a, b) => a.id - b.id);
    this.ui.notify(text, tone);
  }
  private get capacity(): number { return TOOL_CAPACITIES[this.selectedTool][Math.max(0, this.tools[this.selectedTool] - 1)]; }
  private get load(): number { return this.raw + this.purified + this.ice * 5; }
  private get tankReady(): boolean { return this.load > 0.001; }
  private get toolDef() { return TOOLS.find((tool) => tool.id === this.selectedTool)!; }
  private get toolLevel(): number { return this.tools[this.selectedTool]; }
  private get toolStats() { return toolTierStats(this.selectedTool, this.toolLevel); }
  private get clearRadius(): number { return this.toolStats.radius; }
  private get clearRate(): number { return this.toolStats.rate; }
  private get toolYield(): number { return this.toolStats.yield; }
  private get scannerRadius(): number { return [30, 38, 46, 55][this.upgrades.scanner]; }
  private get scannerMax(): number { return [6, 4.8, 3.8, 2.8][this.upgrades.scanner]; }
  private get speed(): number { return GAME.playerSpeed * (1 + this.upgrades.boots * 0.12) * (this.stormPhase === "storm" ? GAME.stormSpeedMultiplier : 1); }
  private get actualSpeed(): number { return this.speed * (this.sprinting ? GAME.sprintMultiplier : 1); }
  private get heatFactor(): number { return [1, 0.78, 0.62, 0.48][this.upgrades.thermal]; }

  private resetRun(): void {
    this.finishWorkAim(); this.cancelBuild(); this.debugClear = false; this.upgrades = blankUpgrades(); this.tools = blankTools(); this.toolHealth = fullToolHealth(); this.salesHistory = []; this.saleRemainder = 0; this.selectedTool = "hands";
    this.raw = 0; this.purified = 0; this.ice = 0; this.credits = 0; this.heat = 100; this.power = 15; this.recovered = 0;
    this.produced = 0; this.collectedRaw = 0; this.purifiedSold = 0; this.iceSold = 0; this.sold = 0; this.rawSold = 0; this.railDelivered = 0; this.questIndex = 0; this.cleanupCertified = false; this.heatWarningArmed = true;
    this.runTime = 0; this.visualTime = 0; this.walkTime = 0; this.scannerCooldown = 0; this.radarCharges = 3; this.nextStormAt = GAME.firstStormAt;
    this.random = mulberry32(GAME.seed + 991); this.stormCount = 0; this.nextSevereStorm = 5 + Math.floor(this.random() * 3); this.severeStorm = false; this.forceNextSevere = false;
    this.radarActive = false; this.sprinting = false; this.events = []; this.nextEventId = 1; this.alertTimes.clear();
    this.scannerSignal = { strength: 0, sector: 0, band: 0 }; this.signalAge = 99; this.lastFrozenCount = 0;
    this.stormPhase = "calm"; this.stormTimer = 0; this.stormIntensity = 0; this.prompt = ""; this.pausePanel = "menu"; this.saveTimer = 0;
    this.rails.reset(); this.buildings.reset(); this.relays.reset(); this.buildings.setAuxiliaryZones([]); this.buildings.setRelayBoosts(1, 1); this.world.reset(); this.snow.reset(); this.effects.reset();
    this.player.group.position.set(GAME.spawn.x, this.snow.heightAt(GAME.spawn.x, GAME.spawn.z), GAME.spawn.z); this.player.group.rotation.y = Math.PI;
    this.previousPose.position.copy(this.player.group.position); this.currentPose.position.copy(this.player.group.position); this.previousPose.yaw = this.currentPose.yaw = Math.PI;
    this.physics.reset(GAME.spawn.x, GAME.spawn.z); this.player.nozzle.scale.set(1, 1, 1); this.player.nozzle.rotation.set(0, 0, 0);
    this.facing.set(0, 0, -1); this.effects.hideAim(); this.input?.resetAll(); this.audio.setStorm(0); this.updateToolVisual();
  }
  private startRun(playOpening = true): void {
    if (this.cinematic?.active) this.cinematic.skip(); if (this.tutorial?.active) this.tutorial.skip();
    storage.remove(GAME.saveKey); this.hasSave = false; this.migrationRadarRefund = false; this.resetRun(); if (!this.state.is("playing")) this.state.transition("playing");
    else this.ui.showState("playing"); this.audio.sfx("ui"); this.effects.targetRing.visible = true;
    if (playOpening) this.cinematic.start();
    this.ui.notify(this.t("quest.0.desc")); this.updateUI();
  }
  private openTutorial(): void {
    if (!this.state.is("playing") && !this.state.is("paused") && !this.state.is("gameover")) return;
    if (this.state.is("paused")) this.resume();
    this.tutorial.start(); this.updateUI();
  }
  private continueRun(): void { const save = this.readSave(); if (!save) { this.startRun(); return; } this.restore(save); if (!this.state.is("playing")) this.state.transition(save.status === "gameover" ? "gameover" : "playing"); this.effects.targetRing.visible = save.status !== "gameover"; this.updateUI(); }
  private pause(): void { if (!this.state.is("playing")) return; this.input.resetAll(); this.cancelBuild(); this.pausePanel = "menu"; this.saveGame(); this.state.transition("paused"); this.audio.sfx("ui"); }
  private resume(): void { if (!this.state.is("paused")) return; this.input.resetAll(); this.pausePanel = "menu"; this.state.transition("playing"); this.audio.sfx("ui"); }
  private closePanel(): void {
    this.input.resetAll();
    if (this.state.is("paused")) {
      if (this.pausePanel === "settings" && this.settingsReturnToPause) { this.pausePanel = "menu"; this.ui.showState("paused", "menu"); }
      else this.resume();
    } else { this.pausePanel = "menu"; this.ui.showState("title"); }
    this.settingsReturnToPause = false;
  }
  private openUpgrades(): void { this.input.resetAll(); if (!this.state.is("playing") && !this.state.is("paused")) return; this.cancelBuild(); this.pausePanel = "upgrades"; if (this.state.is("playing")) this.state.transition("paused"); else this.ui.showState("paused", this.pausePanel); this.audio.sfx("ui"); this.updateUI(); }
  private openSettings(): void {
    this.settingsReturnToPause = this.state.is("paused") && this.pausePanel === "menu";
    this.input.resetAll(); this.cancelBuild(); this.pausePanel = "settings";
    if (this.state.is("playing")) this.state.transition("paused"); else this.ui.showState(this.state.state, this.pausePanel);
    this.audio.sfx("ui"); this.updateUI();
  }
  private openLog(): void {
    this.input.resetAll(); this.cancelBuild(); this.pausePanel = "log";
    if (this.state.is("playing")) this.state.transition("paused"); else this.ui.showState(this.state.state, this.pausePanel);
    this.audio.sfx("ui"); this.updateUI();
  }
  private openRobots(): void {
    this.input.resetAll();
    if (!this.state.is("playing") && !this.state.is("paused") && !this.state.is("gameover")) return;
    this.cancelBuild(); this.pausePanel = "robots";
    if (this.state.is("playing")) this.state.transition("paused"); else this.ui.showState("paused", this.pausePanel);
    this.audio.sfx("ui"); this.updateUI();
  }
  private toggleMute(): void { this.audio.toggleMute(); this.updateUI(); }

  private charge(cost: number): boolean { if (this.credits < cost) return false; this.credits -= cost; return true; }
  private buyUpgrade(id: UpgradeId): void {
    const level = this.upgrades[id]; const def = UPGRADES.find((u) => u.id === id)!; if (level >= 3) return;
    if (!this.charge(def.costs[level])) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.noCredits"), "warm"); return; }
    this.upgrades[id] = level + 1; this.audio.sfx("upgrade"); this.ui.notify(`${this.t(`upgrade.${id}.name`)} · ${this.t("toast.upgraded")}`, "warm");
    this.effects.burst(this.player.group.position.x, this.player.group.position.y + 1.4, this.player.group.position.z, COLORS.cyan, 20); this.updateUI();
  }
  private buyBattery(): void {
    if (this.radarCharges >= this.radarMaxCharges) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.batteryFull"), "info"); return; }
    if (!this.charge(this.radarBatteryCost)) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.noCredits"), "warm"); return; }
    this.radarCharges++;
    this.audio.sfx("upgrade"); this.ui.notify(`${this.t("shop.battery")} · ${this.radarCharges} / ${this.radarMaxCharges}`, "warm");
    this.updateUI();
  }

  private repairRelay(id: RelayId): boolean {
    const relay = this.relays.items.find((item) => item.id === id); if (!relay || relay.repaired) return false;
    if (this.questIndex < 2) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.relayLocked"), "warm"); return false; }
    if (!this.charge(relay.cost)) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.noCredits"), "warm"); return false; }
    this.relays.repair(id);
    this.power = Math.min(100, this.power + 4);
    if (id === "gale" && this.stormPhase === "storm" && this.buildings.relayPowered("gale")) this.stormTimer = Math.max(0.1, this.stormTimer * 0.72);
    this.audio.sfx("repair");
    this.recordEvent(`${this.t(`relay.${id}.name`)} · ${this.t(`relay.${id}.bonus`)}`, "warm", "event");
    this.effects.scan(relay.x, relay.z, groundHeight(relay.x, relay.z) + 0.2); this.effects.burst(relay.x, 2, relay.z, COLORS.cyan, 28);
    this.saveGame(); this.updateUI(); return true;
  }

  private buyTool(id: ToolId): void {
    const def = TOOLS.find((tool) => tool.id === id)!; const level = this.tools[id];
    if (this.questIndex < def.unlockQuest || level >= 4) { this.audio.sfx("empty"); return; }
    const cost = level === 0 ? def.cost : TOOL_UPGRADES[id][level - 1];
    if (!this.charge(cost)) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.noCredits"), "warm"); return; }
    this.tools[id] = level + 1; this.selectedTool = id; this.audio.sfx("upgrade"); this.ui.notify(this.t(`tool.${id}.name`), "warm"); this.updateToolVisual(); this.updateUI();
  }
  private selectTool(id: ToolId): void { if (!this.tools[id]) return; this.selectedTool = id; this.audio.sfx("ui"); this.updateToolVisual(); this.ui.notify(this.t(this.toolHealth[id] <= 0 ? "toast.toolBroken" : "toast.tool"), this.toolHealth[id] <= 0 ? "danger" : "info"); this.updateUI(); }
  private repairTool(id: ToolId): boolean {
    if (!this.tools[id] || this.toolHealth[id] >= 99.99) return false;
    if (!this.charge(toolRepairCost(id, this.tools[id]))) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.noCredits"), "warm"); return false; }
    this.toolHealth[id] = 100; this.audio.sfx("repair"); this.ui.notify(this.t("toast.toolRepaired"), "warm"); this.saveGame(); this.updateUI(); return true;
  }
  private updateToolVisual(): void {
    for (const id of Object.keys(this.player.tools) as ToolId[]) this.player.tools[id].visible = id === this.selectedTool;
    const scale = 1 + (this.tools[this.selectedTool] - 1) * 0.055; this.player.nozzle.scale.setScalar(scale);
  }

  private scan(): void {
    if (!this.state.is("playing")) return;
    if (this.scannerCooldown > 0 || this.radarCharges <= 0) { this.audio.sfx("empty"); if (this.radarCharges <= 0) this.ui.notify(this.t("toast.noBattery"), "warm"); return; }
    this.radarCharges--;
    this.scannerCooldown = this.scannerMax; this.signalAge = 0; const p = this.player.group.position; this.effects.scan(p.x, p.z, p.y + 0.16); this.audio.sfx("scan");
    let best: { distance: number; core: CoreEntity } | null = null;
    for (const core of this.world.cores) if (!core.recovered) {
      const distance = Math.hypot(core.x - p.x, core.z - p.z);
      if (distance <= this.scannerRadius && (!best || distance < best.distance)) best = { distance, core };
    }
    if (best) {
      const strength = THREE.MathUtils.clamp(1 - best.distance / this.scannerRadius, 0.06, 1);
      const angle = (Math.atan2(best.core.x - p.x, -(best.core.z - p.z)) + Math.PI * 2) % (Math.PI * 2);
      this.scannerSignal = { strength, sector: Math.round(angle / (Math.PI / 4)) % 8, band: strength > 0.66 ? 2 : strength > 0.33 ? 1 : 0 };
      best.core.scanned = true;
      this.ui.notify(`${this.t("toast.signal")} · ${Math.round(strength * 100)}% · ${this.t("toast.discovered")}`, "info");
    } else { this.scannerSignal = { strength: 0, sector: 0, band: 0 }; this.ui.notify(this.t("toast.noSignal"), "warm"); }
    this.updateUI();
  }

  private recoverCore(core: CoreEntity, grantReward = true): void {
    this.world.recover(core); this.recovered++;
    if (grantReward) {
      this.credits += 120; this.power = Math.min(100, this.power + 12); this.heat = Math.min(100, this.heat + 20);
      this.audio.sfx("pickup"); this.ui.reward(`+120 ◈ · ${this.t(`core.${core.id}`)}`);
    }
    this.recordEvent(this.t(`log.${core.id}`), "info", "clue", `log.${core.id}`);
  }

  private interact(): void {
    if (!this.state.is("playing")) return; const p = this.player.group.position; this.interactionAnim = 1;
    for (const core of this.world.cores) if (!core.recovered && core.revealed && Math.hypot(core.x - p.x, core.z - p.z) < 2.4) {
      this.recoverCore(core);
      this.effects.burst(p.x, p.y + 1.3, p.z, COLORS.cyan, 36); this.updateQuest(); this.updateUI(); return;
    }
    const rescue = this.buildings.startRescue(p.x, p.z);
    if (rescue !== "none") {
      if (rescue === "funding") { this.audio.sfx("empty"); this.ui.notify(this.t("toast.noCredits"), "warm"); }
      else { this.audio.sfx("deposit"); this.ui.notify(this.t(rescue === "active" ? "toast.rescueActive" : "toast.rescueStart"), "info"); }
      this.updateUI(); return;
    }
    const relay = this.relays.nearest(p.x, p.z);
    if (relay) {
      if (relay.repaired) { this.recordEvent(`${this.t(`relay.${relay.id}.name`)} · ${this.t(`relay.${relay.id}.bonus`)}`, "info", "event"); this.updateUI(); }
      else this.repairRelay(relay.id);
      return;
    }
    if (Math.hypot(p.x - this.world.depotPos.x, p.z - this.world.depotPos.z) < 3.3) {
      if (this.load < 0.01) { this.audio.sfx("empty"); this.ui.notify(this.t("prompt.empty"), "warm"); return; }
      const before = this.credits;
      if (this.raw > 0) { const n = this.raw; this.raw = 0; this.sell("raw", n, false); }
      if (this.purified > 0) { const n = this.purified; this.purified = 0; this.sell("purified", n, false); }
      if (this.ice > 0) { const n = this.ice; this.ice = 0; this.sell("ice", n, false); }
      const earned = this.credits - before;
      if (earned > 0) this.audio.sfx("sell"); this.heat = 100; this.ui.notify(this.t("toast.sold"), "warm"); this.ui.reward(`${this.t("reward.sale")} · +${earned} ◈`);
      this.effects.burst(this.world.depotPos.x, 2.2, this.world.depotPos.z, COLORS.warm, 38); this.updateUI(); return;
    }
    if (Math.hypot(p.x - this.world.fabricatorPos.x, p.z - this.world.fabricatorPos.z) < 3.2) { this.openUpgrades(); return; }
    const b = this.buildings.nearest(p.x, p.z); if (b) {
      if (b.damaged || this.buildings.robotServiceCost(b) > 0) { this.repairNearest(); return; }
      const carried = b.type === "purifier" || b.type === "sweeper" ? this.raw : b.type === "press" ? this.purified : 0;
      const outputKind = this.buildings.cargoKind(b); const room = Math.max(0, this.capacity - this.load);
      const maxCollect = outputKind === "ice" ? Math.floor(room / 5) : room;
      const result = this.buildings.interact(b, carried, maxCollect);
      if (result.accepted > 0) {
        if (b.type === "purifier" || b.type === "sweeper") this.raw -= result.accepted; else if (b.type === "press") this.purified -= result.accepted;
        this.audio.sfx("deposit"); this.effects.burst(b.x, groundHeight(b.x, b.z) + 1.4, b.z, COLORS.cyan, 12);
      } else if (result.collected > 0 && result.kind) {
        if (result.kind === "raw") this.raw += result.collected; else if (result.kind === "purified") this.purified += result.collected; else this.ice += result.collected;
        this.audio.sfx("pickup"); this.effects.burst(b.x, groundHeight(b.x, b.z) + 1.2, b.z, COLORS.warm, 12);
      } else { this.audio.sfx("empty"); this.ui.notify(this.t(room <= 0.01 ? "toast.full" : "prompt.empty"), "warm"); }
      this.updateUI(); return;
    }
    this.audio.sfx("empty");
  }

  private sell(kind: CargoKind, amount: number, byRail: boolean): number {
    if (!(amount > 0) || !Number.isFinite(amount)) return 0;
    const rate = kind === "ice" ? 42 : kind === "purified" ? 6 : 1.5;
    const exact = amount * rate + this.saleRemainder;
    const earned = Math.max(0, Math.floor(exact + 1e-9));
    this.saleRemainder = Math.max(0, exact - earned);
    if (this.saleRemainder < 1e-9) this.saleRemainder = 0;
    this.credits += earned; this.sold += earned;
    if (earned > 0) {
      this.salesHistory.push({ time: this.runTime, amount: earned });
      if (this.salesHistory.length > 500) this.salesHistory.splice(0, this.salesHistory.length - 500);
      if (byRail) this.effects.burst(this.world.depotPos.x, 1.8, this.world.depotPos.z, COLORS.warm, 18);
    }
    if (kind === "raw") this.rawSold += amount;
    if (kind === "ice") this.iceSold += amount;
    else if (kind === "purified") this.purifiedSold += amount;
    this.updateQuest(); return earned;
  }

  private questProgress(index = this.questIndex): number {
    switch (index) {
      case 0: return this.rawSold; case 1: return this.buildings.count("purifier"); case 2: return this.produced;
      case 3: return this.purifiedSold; case 4: return this.buildings.count("press"); case 5: return this.iceSold;
      case 6: return this.railDelivered; case 7: return this.buildings.robotCount();
      case 8: return this.buildings.items.filter((building) => building.type === "heater" && building.powered).length;
      case 9: return Math.min((this.cleanupCertified ? 1 : this.snow.cleanupPercent / GAME.clearanceGoal), this.recovered / 3, Math.min(100, this.power) / 100) * 100;
      default: return 0;
    }
  }
  private updateQuest(): void {
    if (this.snow.cleanupPercent >= GAME.clearanceGoal) this.cleanupCertified = true;
    let guard = 0;
    while (this.questIndex < 9 && this.questProgress() + 0.01 >= QUESTS[this.questIndex].target && guard++ < 10) {
      const completed = this.questIndex;
      const q = QUESTS[this.questIndex]; this.credits += q.reward; this.power = Math.min(100, this.power + q.power);
      const hint = completed === 1 ? ` ${this.t("radar.unlock")}` : "";
      this.ui.notify(`${this.t("toast.quest")} · +${q.reward} ${this.t("toast.reward")}${hint}`, "warm"); this.ui.reward(`${this.t("reward.quest")} · +${q.reward} ◈`);
      this.audio.sfx("upgrade"); const p = this.player.group.position; this.effects.burst(p.x, p.y + 1.5, p.z, COLORS.warm, 34); this.questIndex++;
    }
    if (this.questIndex === 9 && this.recovered >= 3 && this.power >= 99.99 && this.cleanupCertified && this.state.is("playing")) {
      this.saveGame(); this.state.transition("victory"); this.audio.sfx("win"); this.effects.hideAim();
    }
  }
  private gameOver(): void { if (!this.state.is("playing")) return; this.heat = 0; this.input.resetAll(); this.state.transition("gameover"); this.saveGame(); this.audio.sfx("lose"); this.effects.hideAim(); this.updateUI(); }
  private recoverCheckpoint(): void {
    if (!this.state.is("gameover")) return;
    this.heat = 100; this.input.resetAll(); this.cancelBuild();
    this.player.group.position.set(GAME.spawn.x, this.snow.heightAt(GAME.spawn.x, GAME.spawn.z), GAME.spawn.z);
    this.physics.reset(GAME.spawn.x, GAME.spawn.z);
    this.state.transition("playing"); this.saveGame(); this.audio.sfx("repair"); this.updateUI();
  }

  private selectBuild(type: BuildingType): void {
    if (!this.state.is("playing")) return;
    if (this.questIndex < BUILDINGS[type].unlockQuest) { this.ui.notify(this.t("toast.locked"), "warm"); return; }
    if (this.buildMode !== type) { for (const child of [...this.ghost.children]) disposeObject(child, true); this.ghost.clear(); this.ghost.add(this.buildings.createGhost(type)); }
    this.buildMode = type; this.railSource = null; this.clearRailDraft(); this.relocating = null; this.input.mode = "build"; this.input.cameraRotate = false; this.ghost.visible = true; this.railPreview.visible = false; this.audio.sfx("ui"); this.updateUI();
  }
  private selectRail(): void {
    if (!this.state.is("playing")) return; if (this.questIndex < 6) { this.ui.notify(this.t("toast.locked"), "warm"); return; }
    if (this.buildMode === "rail") { this.cancelBuild(); this.audio.sfx("ui"); this.updateUI(); return; }
    this.buildMode = "rail"; this.railSource = null; this.clearRailDraft(); this.drawArmed = true; this.relocating = null; this.input.mode = "build"; this.input.cameraRotate = true; this.ghost.visible = false; this.railPreview.visible = false; this.audio.sfx("ui"); this.updateUI();
  }
  private cancelBuild(): void {
    const restoreCamera = this.buildMode === "rail";
    this.buildMode = null; this.railSource = null; this.junctionArm = null; this.sharedArm = false; this.selectedJunction = null; this.clearRailDraft(); this.relocating = null;
    if (restoreCamera) { this.cameraAzimuth = Math.atan2(14, 18); this.cameraZoom = 1; }
    if (this.input) { this.input.mode = "play"; this.input.cameraRotate = false; }
    if (this.ghost) this.ghost.visible = false; if (this.railPreview) this.railPreview.visible = false;
  }
  private clearRailDraft(): void {
    this.railDraft = null; this.networkDraft = null; this.strokePlan = null; this.strokeRaw = null; this.stroke = null; this.anchor = null; this.editMode = false; this.railDrag = null; this.rails.network.setFocus(0);
    if (this.railHandles) { this.railHandles.visible = false; for (const handle of this.railHandles.children) handle.visible = false; }
  }
  private cancelRailDraft(): void {
    if (!this.railDraft && !this.networkDraft && !this.strokePlan) { this.cancelBuild(); return; }
    this.railSource = null; this.clearRailDraft(); this.railPreview.visible = false; this.audio.sfx("ui"); this.updateUI();
  }
  private endpointLabel(id: number): string {
    if (id < 0) return this.t("rail.junction");
    if (id === 0) return this.t("rail.depot");
    const building = this.buildings.byId(id);
    return building ? this.t(`building.${building.type}.name`) : this.t("rail.junction");
  }
  private railSelectionView(): GameSnapshot["railSelection"] {
    if (this.selectedEdgeId == null || this.buildMode !== "rail" || this.strokePlan) return null;
    const edge = this.rails.network.describeEdge(this.selectedEdgeId);
    if (!edge) return null;
    return { edgeId: edge.id, source: this.endpointLabel(edge.from), destination: this.endpointLabel(edge.to), kind: edge.kind, busy: edge.busy };
  }
  private beginRailEdit(): void {
    const edge = this.selectedEdgeId == null ? null : this.rails.network.describeEdge(this.selectedEdgeId);
    if (!edge) return;
    if (edge.busy) { this.ui.notify(this.t("rail.busy"), "warm"); return; }
    this.editMode = true; this.drawArmed = true; this.anchor = null; this.audio.sfx("ui"); this.updateUI();
  }
  private beginRailExtend(): void {
    const edge = this.selectedEdgeId == null ? null : this.rails.network.describeEdge(this.selectedEdgeId);
    if (!edge || edge.points.length < 2) return;
    const end = edge.points[edge.points.length - 1];
    this.anchor = { x: end.x, z: end.z }; this.editMode = false; this.drawArmed = true; this.audio.sfx("ui"); this.ui.notify(this.t("rail.drawHint")); this.updateUI();
  }
  private deleteSelectedRail(): void {
    if (this.selectedEdgeId == null) return;
    const result = this.rails.network.removeEdge(this.selectedEdgeId);
    if (!result.ok) { this.ui.notify(this.t(result.reason === "occupied" ? "rail.busy" : "toast.railInvalid"), "warm"); this.audio.sfx("empty"); return; }
    this.selectedEdgeId = null; this.audio.sfx("ui"); this.ui.notify(this.t("rail.branchKept"), "warm"); this.saveGame(); this.updateUI();
  }
  private openStroke(raw: RailPathPoint[]): void {
    if (this.editMode && this.selectedEdgeId != null) {
      const edge = this.rails.network.describeEdge(this.selectedEdgeId);
      if (!edge) return;
      this.strokePlan = { ok: !edge.busy, reason: edge.busy ? "occupied" : "edited", cost: 0, total: 0, points: raw, kind: edge.kind, junctions: [], sourceId: edge.from, destinationId: edge.to };
      this.strokeRaw = raw.map((point) => ({ ...point })); this.anchor = null; this.stroke = null;
      this.drawRailPath(raw, !edge.busy); this.updateUI(); return;
    }
    const plan = this.rails.network.previewStroke(raw);
    this.strokePlan = plan; this.strokeRaw = raw.map((point) => ({ ...point })); this.anchor = null; this.stroke = null;
    if (plan.points.length >= 2) this.drawRailPath(plan.points, plan.ok);
    const junction = plan.junctions.includes("cross") ? "rail.cross" : plan.junctions.length ? "rail.junctionNew" : plan.ok ? "rail.netReady" : plan.reason === "open" ? "rail.drawOpen" : plan.reason === "cargo" ? "rail.netCargo" : plan.reason === "blocked" ? "toast.railBlocked" : plan.reason === "occupied" ? "rail.busy" : "toast.railInvalid";
    this.ui.notify(this.t(junction), plan.ok ? "info" : "warm");
    if (!plan.ok && plan.reason === "open") { this.strokePlan = null; this.strokeRaw = null; this.anchor = raw[raw.length - 1] ?? null; }
    this.audio.sfx(plan.ok ? "ui" : "empty"); this.updateUI();
  }
  private confirmStroke(): { ok: boolean; reason: string; extra: number; total: number } {
    const raw = this.strokeRaw; const edgeId = this.editMode ? this.selectedEdgeId : null;
    if (!raw) return { ok: false, reason: "none", extra: 0, total: 0 };
    const result = edgeId != null
      ? this.rails.network.reshape(edgeId, raw, (cost) => this.charge(cost))
      : this.rails.network.commitStroke(raw, (cost) => this.charge(cost));
    this.clearRailDraft(); this.railPreview.visible = false;
    if (!result.ok) { this.audio.sfx("empty"); this.ui.notify(this.t(result.reason === "occupied" ? "rail.busy" : result.reason === "credits" ? "toast.noCredits" : result.reason === "cargo" ? "rail.netCargo" : result.reason === "blocked" ? "toast.railBlocked" : "toast.railInvalid"), "warm"); this.updateUI(); return { ok: false, reason: result.reason, extra: result.cost, total: result.total }; }
    this.audio.sfx("rail"); this.ui.notify(this.t("rail.netDone"), "warm"); this.saveGame(); this.updateUI();
    return { ok: true, reason: result.reason, extra: result.cost, total: result.total };
  }
  private tapRail(x: number, y: number): void {
    if (this.strokePlan || this.networkDraft || this.railDraft || !this.drawArmed) return;
    const point = this.groundFromPointer(x, y); if (!point) return;
    if (this.anchor) { this.openStroke([this.anchor, { x: point.x, z: point.z }]); return; }
    const junction = this.rails.network.hit(point.x, point.z, this.input.isCoarse ? 3.2 : 1.8);
    if (junction) { this.selectedJunction = junction.id; this.selectedEdgeId = null; this.rails.network.setFocus(junction.id); this.audio.sfx("ui"); this.updateUI(); return; }
    const edge = this.rails.network.hitEdge(point.x, point.z, this.input.isCoarse ? 2.2 : 1.35);
    const nearPort = this.buildings.items.some((building) => (building.type === "sweeper" || building.type === "purifier" || building.type === "press") && Math.hypot(point.x - building.x, point.z - building.z) < 3.15) || Math.hypot(point.x - GAME.depot.x, point.z - GAME.depot.z) <= 4.2;
    if (nearPort) { this.anchor = { x: point.x, z: point.z }; this.ui.notify(this.t("rail.drawHint")); this.updateUI(); return; }
    if (edge) { this.selectedEdgeId = edge.edgeId; this.selectedJunction = null; this.anchor = { x: point.x, z: point.z }; this.rails.network.setFocus(0); this.ui.notify(this.t("rail.drawHint")); this.audio.sfx("ui"); this.updateUI(); }
  }
  private followStroke(): void {
    const down = this.input.pointerDown && this.buildMode === "rail" && this.drawArmed && !this.strokePlan && !this.networkDraft && !this.railDraft;
    if (down && !this.strokeWasDown) {
      const point = this.groundFromPointer(this.input.pointerX, this.input.pointerY);
      this.stroke = point ? [{ x: point.x, z: point.z }] : null;
    } else if (down && this.stroke) {
      const point = this.groundFromPointer(this.input.pointerX, this.input.pointerY);
      const last = this.stroke[this.stroke.length - 1];
      if (point && last && Math.hypot(point.x - last.x, point.z - last.z) >= 0.28) {
        this.stroke.push({ x: point.x, z: point.z });
        this.drawRailPath(this.stroke, true);
      }
    } else if (!this.input.pointerDown && this.strokeWasDown && this.stroke && this.stroke.length > 1) {
      const end = this.stroke[this.stroke.length - 1];
      const start = this.stroke[0];
      if (Math.hypot(end.x - start.x, end.z - start.z) >= 1.15) this.openStroke(this.anchor ? [this.anchor, ...this.stroke] : this.stroke);
      this.stroke = null;
    }
    if (!this.input.pointerDown) this.strokeWasDown = false; else this.strokeWasDown = this.buildMode === "rail";
  }
  private railEndpoint(destinationId: number): RailPathPoint | null {
    if (destinationId === 0) return { x: GAME.depot.x, z: GAME.depot.z - 1.7 };
    const target = this.buildings.byId(destinationId); return target ? { x: target.x, z: target.z } : null;
  }
  private footprints(): Array<{ x: number; z: number; radius: number }> {
    return this.buildings.items.map((building) => ({ x: building.x, z: building.z, radius: BUILDINGS[building.type].radius }));
  }
  private openRailDraft(sourceId: number, destinationId: number, controls: RailPathPoint[], lane: number, paid: number, existing: boolean): void {
    this.railDraft = { sourceId, destinationId, controls: controls.map((point) => ({ ...point })), lane, paid, existing, selected: null };
    this.railSource = sourceId; this.railDrag = null; this.syncRailHandles(); this.updateUI();
  }
  private hitRailHandle(x: number, z: number): number {
    const draft = this.railDraft; if (!draft) return -1;
    const reach = this.input.isCoarse ? 2.6 : 1.55;
    let best = -1, bestD = reach;
    for (let i = 1; i < draft.controls.length - 1; i++) {
      const dist = Math.hypot(x - draft.controls[i].x, z - draft.controls[i].z);
      if (dist < bestD) { best = i; bestD = dist; }
    }
    return best;
  }
  private syncRailHandles(): void {
    const draft = this.railDraft; this.railHandles.visible = !!draft;
    this.railHandles.children.forEach((handle, index) => {
      const point = draft?.controls[index];
      handle.visible = !!point;
      if (!point) return;
      handle.position.set(point.x, groundHeight(point.x, point.z) + 1.25, point.z);
      const endpoint = index === 0 || index === draft!.controls.length - 1;
      handle.scale.setScalar(endpoint ? 0.55 : draft!.selected === index ? 1.25 : 0.95);
      ((handle as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(endpoint ? 0x79f0df : draft!.selected === index ? 0xfff0b0 : 0xffc56a);
    });
  }
  private drawRailPath(points: RailPathPoint[], valid: boolean): void {
    const attr = this.railPreview.geometry.getAttribute("position") as THREE.BufferAttribute;
    const count = Math.min(96, points.length);
    for (let i = 0; i < count; i++) { const point = points[Math.min(i, points.length - 1)]; attr.setXYZ(i, point.x, groundHeight(point.x, point.z) + 1.45, point.z); }
    attr.needsUpdate = true; this.railPreview.geometry.setDrawRange(0, count); this.railPreview.geometry.computeBoundingSphere(); this.railPreview.computeLineDistances();
    const material = this.railPreview.material as THREE.LineDashedMaterial;
    material.color.setHex(valid ? COLORS.cyan : 0xff4b3e); material.dashSize = valid ? 0.85 : 0.34; material.gapSize = valid ? 0.22 : 0.28; material.opacity = valid ? 0.85 : 1;
    this.railPreview.visible = count >= 2;
  }
  private draftQuote() {
    const draft = this.railDraft; if (!draft) return null;
    const source = this.buildings.byId(draft.sourceId); const dest = this.railEndpoint(draft.destinationId);
    if (!source || !dest) return null;
    const quote = this.rails.quote(draft.controls, draft.lane, true);
    const blocked = RailSystem.blocked(quote.points, this.footprints(), { x: source.x, z: source.z }, dest);
    const extra = draft.existing ? Math.max(0, quote.cost - draft.paid) : quote.cost;
    return { quote, blocked, extra, source, dest, valid: !blocked && quote.total >= 2 && extra <= this.credits };
  }
  private endName(end: NetEnd): string {
    if ("nodeId" in end) { const node = this.rails.network.inspect(end.nodeId); return node ? this.t(node.kind === "merge" ? "rail.merge" : "rail.split") : this.t("rail.junction"); }
    if (end.buildingId === 0) return this.t("rail.depot");
    const building = this.buildings.byId(end.buildingId); return building ? this.t(`building.${building.type}.name`) : this.t("rail.junction");
  }
  private noteNet(result: NetResult): void {
    const key = result.ok ? (result.reason === "reuse" ? "rail.netReuse" : "rail.netDone") : result.reason === "blocked" ? "toast.railBlocked" : result.reason === "credits" ? "toast.noCredits" : result.reason === "cycle" ? "rail.netCycle" : result.reason === "cargo" ? "rail.netCargo" : result.reason === "occupied" ? "rail.netOccupied" : result.reason === "open" ? "rail.netOpen" : result.reason === "degree" ? "rail.netDegree" : "toast.railInvalid";
    this.ui.notify(this.t(key), "warm"); if (result.ok) this.audio.sfx("rail"); else this.audio.sfx("empty");
  }
  private proposeNet(from: NetEnd, to: NetEnd): void {
    const preview = this.rails.network.preview(from, to);
    if (!preview.kind || (preview.reason !== "blocked" && !preview.ok)) { this.noteNet({ ok: false, reason: preview.reason, cost: 0, edgeId: 0, total: 0 }); return; }
    this.clearRailDraft();
    this.networkDraft = { from, to, points: preview.points, valid: preview.valid, cost: preview.cost, kind: preview.kind, sourceName: this.endName(from), destinationName: this.endName(to) };
    this.sharedArm = false; this.audio.sfx("ui"); this.updateUI();
  }
  /** A junction feeds a destination and is fed by sources: pick the direction the graph can actually accept. */
  private proposeJunctionLink(nodeId: number, buildingId: number): void {
    const view = this.rails.network.inspect(nodeId);
    const feed: [NetEnd, NetEnd] = [{ buildingId, port: "out" }, { nodeId }];
    const drain: [NetEnd, NetEnd] = [{ nodeId }, { buildingId, port: "in" }];
    const [first, second] = view?.kind === "split" ? [drain, feed] : [feed, drain];
    const probe = this.rails.network.preview(first[0], first[1]);
    if (probe.ok || probe.reason === "blocked") { this.proposeNet(first[0], first[1]); return; }
    this.proposeNet(second[0], second[1]);
  }
  private confirmNetwork(): { ok: boolean; reason: string; extra: number; total: number } {
    const draft = this.networkDraft; if (!draft) return { ok: false, reason: "none", extra: 0, total: 0 };
    if (!draft.valid) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.railBlocked"), "warm"); return { ok: false, reason: "blocked", extra: 0, total: 0 }; }
    const result = this.rails.network.link(draft.from, draft.to, (cost) => this.charge(cost));
    this.networkDraft = null; this.railPreview.visible = false; this.noteNet(result);
    if (result.ok) { this.railSource = null; this.saveGame(); }
    this.updateUI();
    return { ok: result.ok, reason: result.reason, extra: result.cost, total: result.total };
  }
  private confirmRailDraft(): { ok: boolean; reason: string; extra: number; total: number } {
    if (this.strokePlan && this.strokeRaw) return this.confirmStroke();
    if (this.networkDraft) return this.confirmNetwork();
    const draft = this.railDraft;
    if (!draft) return { ok: false, reason: "none", extra: 0, total: 0 };
    const view = this.draftQuote();
    if (!view) { this.clearRailDraft(); return { ok: false, reason: "missing", extra: 0, total: 0 }; }
    if (view.blocked) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.railBlocked"), "warm"); return { ok: false, reason: "blocked", extra: 0, total: view.quote.total }; }
    if (view.extra > this.credits) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.noCredits"), "warm"); return { ok: false, reason: "credits", extra: view.extra, total: view.quote.total }; }
    const existing = this.rails.find(draft.sourceId, draft.destinationId);
    if (existing) {
      const same = existing.routed && existing.path.length === draft.controls.length && existing.path.every((point, index) => Math.hypot(point.x - draft.controls[index].x, point.z - draft.controls[index].z) < 0.05);
      if (same) { this.clearRailDraft(); this.railPreview.visible = false; this.updateUI(); return { ok: true, reason: "same", extra: 0, total: existing.total }; }
      const ok = this.rails.retarget(existing, draft.controls, (cost) => this.charge(cost));
      if (!ok) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.noCredits"), "warm"); return { ok: false, reason: "credits", extra: view.extra, total: view.quote.total }; }
      this.audio.sfx("rail"); this.ui.notify(this.t("toast.railEdited"), "warm");
      this.clearRailDraft(); this.railPreview.visible = false; this.saveGame(); this.updateUI();
      return { ok: true, reason: "edited", extra: view.extra, total: existing.total };
    }
    const created = this.rails.create(draft.sourceId, draft.destinationId, draft.controls, (cost) => this.charge(cost), false, { lane: draft.lane, routed: true });
    if (!created) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.railInvalid"), "warm"); return { ok: false, reason: "invalid", extra: 0, total: view.quote.total }; }
    this.audio.sfx("rail"); this.ui.notify(this.t("toast.railDone"), "warm"); this.shakeStrength = 0.12;
    this.clearRailDraft(); this.railSource = null; this.railPreview.visible = false; this.updateQuest(); this.saveGame(); this.updateUI();
    return { ok: true, reason: "created", extra: created.paid, total: created.total };
  }
  private removeRailPoint(index = this.railDraft?.selected ?? -1): boolean {
    const draft = this.railDraft; if (!draft || index <= 0 || index >= draft.controls.length - 1) return false;
    draft.controls.splice(index, 1); draft.selected = null; this.syncRailHandles(); this.updateUI(); return true;
  }
  private placeRail(x: number, z: number): void {
    const handle = this.hitRailHandle(x, z);
    if (handle > 0) { this.railDrag = { index: handle, moved: false, wasSelected: this.railDraft!.selected === handle }; this.railDraft!.selected = handle; this.syncRailHandles(); this.updateUI(); return; }
    if (this.junctionArm && !this.railDraft) {
      const id = this.rails.network.place(this.junctionArm, x, z);
      this.selectedJunction = id; this.junctionArm = null; this.audio.sfx("rail"); this.saveGame(); this.updateUI(); return;
    }
    const junction = this.rails.network.hit(x, z, this.input.isCoarse ? 3.6 : 2.7);
    if (!this.railDraft && junction && this.railSource !== null) { this.proposeNet({ buildingId: this.railSource, port: "out" }, { nodeId: junction.id }); this.railSource = null; return; }
    if (!this.railDraft && junction && this.selectedJunction != null && junction.id !== this.selectedJunction) { this.proposeNet({ nodeId: this.selectedJunction }, { nodeId: junction.id }); return; }
    if (!this.railDraft && junction) { this.selectedJunction = junction.id; this.audio.sfx("ui"); this.updateUI(); return; }
    const nearDepot = Math.hypot(x - GAME.depot.x, z - GAME.depot.z) <= 4.2;
    if (!this.railDraft && this.selectedJunction != null && nearDepot) { this.proposeNet({ nodeId: this.selectedJunction }, { buildingId: 0, port: "in" }); return; }
    const nearSource = this.buildings.items.find((building) => (building.type === "sweeper" || building.type === "purifier" || building.type === "press") && Math.hypot(x - building.x, z - building.z) < 2.4);
    const route = this.rails.hit(x, z, this.input.isCoarse ? 2.2 : 1.35);
    if (!this.railDraft && route && !nearSource) {
      const end = this.railEndpoint(route.destinationId); if (!end) return;
      this.openRailDraft(route.sourceId, route.destinationId, route.path.map((point) => ({ ...point })), route.lane, route.paid, true);
      this.audio.sfx("ui"); this.updateUI(); return;
    }
    if (!this.railDraft && this.selectedJunction != null && nearSource) { this.proposeJunctionLink(this.selectedJunction, nearSource.id); return; }
    if (!this.railDraft && this.railSource === null) {
      const source = nearSource ?? this.buildings.items.find((building) => (building.type === "sweeper" || building.type === "purifier" || building.type === "press") && Math.hypot(x - building.x, z - building.z) < 3.2);
      if (!source) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.railInvalid"), "warm"); return; }
      this.railSource = source.id; this.audio.sfx("ui"); this.ui.notify(this.t("toast.railSource")); this.updateUI(); return;
    }
    if (!this.railDraft) {
      const sourceId = this.railSource; const source = sourceId === null ? undefined : this.buildings.byId(sourceId); if (!source) { this.cancelBuild(); return; }
      const target = this.resolveRailTarget(x, z, source.id);
      if (!target?.valid) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.railInvalid"), "warm"); return; }
      const existing = this.rails.find(source.id, target.id);
      if (existing) { this.openRailDraft(existing.sourceId, existing.destinationId, existing.path.map((point) => ({ ...point })), existing.lane, existing.paid, true); this.audio.sfx("ui"); return; }
      this.proposeNet({ buildingId: source.id, port: "out" }, { buildingId: target.id, port: "in" });
      this.railSource = null; return;
    }
    const draft = this.railDraft;
    const first = draft.controls[0], last = draft.controls[draft.controls.length - 1];
    if (Math.hypot(x - first.x, z - first.z) < 2.4 || Math.hypot(x - last.x, z - last.z) < 2.4) return;
    if (draft.controls.length >= 10) { this.audio.sfx("empty"); return; }
    let segment = 1, nearest = Infinity;
    for (let i = 1; i < draft.controls.length; i++) {
      const a = draft.controls[i - 1], b = draft.controls[i];
      const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
      const t = len2 < 1e-6 ? 0 : THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
      const dist = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
      if (dist < nearest) { nearest = dist; segment = i; }
    }
    if (nearest > (this.input.isCoarse ? 6 : 4.5)) return;
    if (this.footprints().some((foot) => Math.hypot(x - foot.x, z - foot.z) < foot.radius + 0.4)) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.railBlocked"), "warm"); return; }
    draft.controls.splice(segment, 0, { x, z }); draft.selected = segment; this.syncRailHandles(); this.audio.sfx("ui"); this.updateUI();
  }
  private followRailDrag(): void {
    const drag = this.railDrag; const draft = this.railDraft;
    if (!drag || !draft) return;
    if (this.input.pointerDown) {
      const point = this.groundFromPointer(this.input.pointerX, this.input.pointerY); if (!point) return;
      const current = draft.controls[drag.index]; if (!current) return;
      if (Math.hypot(point.x - current.x, point.z - current.z) > 0.35) drag.moved = true;
      current.x = THREE.MathUtils.clamp(point.x, -64, 64); current.z = THREE.MathUtils.clamp(point.z, -64, 64);
      this.syncRailHandles(); return;
    }
    if (!drag.moved && drag.wasSelected) this.removeRailPoint(drag.index);
    this.railDrag = null; this.updateUI();
  }
  private groundFromPointer(x: number, y: number): THREE.Vector3 | null {
    this.pointer.set(x, y); this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.snow.mesh, false)[0]; if (hit) { this.aimPoint.copy(hit.point); return this.aimPoint; }
    return this.raycaster.ray.intersectPlane(this.groundPlane, this.aimPoint) ? this.aimPoint : null;
  }
  private resolveRailTarget(x: number, z: number, sourceId: number): { id: number; x: number; z: number; valid: boolean } | null {
    const source = this.buildings.byId(sourceId); const kind = source ? this.buildings.cargoKind(source) : null;
    if (!source || !kind) return null;
    const candidates = this.buildings.items.filter((b) => b.id !== sourceId && Math.hypot(x - b.x, z - b.z) < 3.2)
      .sort((a, b) => Math.hypot(x - a.x, z - a.z) - Math.hypot(x - b.x, z - b.z) || a.id - b.id);
    const target = candidates[0];
    const atDepot = Math.hypot(x - GAME.depot.x, z - GAME.depot.z) <= 4.2 && (!target || Math.hypot(x - GAME.depot.x, z - GAME.depot.z) <= Math.hypot(x - target.x, z - target.z));
    if (atDepot) return { id: 0, x: GAME.depot.x, z: GAME.depot.z - 1.7, valid: kind !== "raw" };
    if (!target) return null;
    const valid = (kind === "raw" && target.type === "purifier") || (kind === "purified" && target.type === "press");
    return { id: target.id, x: target.x, z: target.z, valid };
  }
  private placeAt(x: number, z: number): void {
    if (!this.buildMode) return;
    if (this.buildMode === "rail") { this.placeRail(x, z); return; }
    const type = this.buildMode; const def = BUILDINGS[type]; const bx = Math.round(x), bz = Math.round(z);
    if (this.relocating !== null) {
      if (!this.buildings.validPlacement(bx, bz, def.radius, this.relocating, this.player.group.position)) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.invalidBuild"), "warm"); return; }
      if (!this.confirmPowerPlacement(type, bx, bz, this.relocating)) return;
      const id = this.relocating;
      if (!this.buildings.relocate(id, bx, bz)) return;
      this.rails.removeBuilding(id);
      this.clearBuildingPad(bx, bz, def.radius);
      this.audio.sfx("build"); this.effects.scan(bx, bz, groundHeight(bx, bz) + 0.15); this.ui.notify(this.t("toast.moved"), "warm");
      this.cancelBuild(); this.saveGame(); this.updateUI(); return;
    }
    if (!this.buildings.validPlacement(bx, bz, def.radius, undefined, this.player.group.position)) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.invalidBuild"), "warm"); return; }
    if (type === "generator" && !this.buildings.generatorReaches(bx, bz, this.relocating ?? undefined)) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.cableRange"), "warm"); return; }
    if (!this.confirmPowerPlacement(type, bx, bz)) return;
    const b = this.buildings.build(type, bx, bz, (cost) => this.charge(cost));
    if (!b) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.noCredits"), "warm"); return; }
    this.clearBuildingPad(bx, bz, def.radius);
    this.effects.scan(bx, bz, groundHeight(bx, bz) + 0.15); this.effects.burst(bx, groundHeight(bx, bz) + 1, bz, COLORS.cyan, 24); this.audio.sfx("build"); this.ui.notify(`${this.t(`building.${type}.name`)} · ${this.t("toast.built")}`, "warm");
    this.shakeStrength = 0.14; this.cancelBuild(); this.updateQuest(); this.saveGame(); this.updateUI();
  }
  private cleanupGuide(): { x: number; z: number } | null {
    const p = this.player.group.position;
    const hidden = this.world.cores.filter((core) => !core.recovered);
    const ranked = this.snow.chunkViews()
      .filter((chunk) => chunk.remaining >= 0.55)
      .map((chunk) => ({ ...chunk, secret: hidden.some((core) => Math.hypot(core.x - chunk.x, core.z - chunk.z) < 9) }))
      .sort((a, b) => (a.secret === b.secret ? 0 : a.secret ? 1 : -1) || (a.progress < 0.45 ? 0 : 1) - (b.progress < 0.45 ? 0 : 1) || Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    const open = ranked.filter((chunk) => !chunk.secret);
    const pool = open.length ? open : ranked;
    for (const chunk of pool.slice(0, 6)) if (this.buildings.routeExists(p, chunk)) return chunk;
    return pool[0] ?? null;
  }
  private beginWorkArea(): void {
    if (!this.state.is("playing")) return;
    const dock = this.buildings.nearest(this.player.group.position.x, this.player.group.position.z);
    if (!dock || dock.type !== "sweeper" || dock.damaged) { this.audio.sfx("empty"); this.ui.notify(this.t("robot.areaNeedDock"), "warm"); return; }
    this.cancelBuild();
    this.workDock = dock.id; this.workPoint = dock.workArea ? { x: dock.workArea.x, z: dock.workArea.z } : null; this.workLocked = !!dock.workArea;
    this.input.mode = "build"; this.input.cameraRotate = false; this.audio.sfx("ui"); this.updateUI();
  }
  private confirmWorkArea(): void {
    if (this.workDock == null || !this.workPoint) { this.audio.sfx("empty"); this.ui.notify(this.t("robot.areaHint"), "warm"); return; }
    const result = this.buildings.assignWorkArea(this.workDock, this.workPoint.x, this.workPoint.z);
    this.finishWorkAim();
    if (result.ok) { this.audio.sfx("upgrade"); this.ui.notify(this.t("robot.areaLive"), "info"); this.saveGame(); }
    this.updateUI();
  }
  private cancelWorkArea(): void { this.finishWorkAim(); this.audio.sfx("ui"); this.updateUI(); }
  private finishWorkAim(): void {
    this.workDock = null; this.workPoint = null; this.workLocked = false;
    if (this.workRing) this.workRing.visible = false;
    if (this.input && this.buildMode == null) { this.input.mode = "play"; this.input.cameraRotate = false; }
  }
  private clearNearestWorkArea(): void {
    const dock = this.buildings.nearest(this.player.group.position.x, this.player.group.position.z);
    if (!dock || dock.type !== "sweeper") { this.audio.sfx("empty"); return; }
    this.buildings.clearWorkArea(dock.id); this.finishWorkAim(); this.audio.sfx("ui"); this.saveGame(); this.updateUI();
  }
  private followWorkAim(): void {
    if (this.workDock == null || !this.workRing) return;
    const dock = this.buildings.byId(this.workDock);
    if (!dock || dock.type !== "sweeper") { this.finishWorkAim(); return; }
    if (!this.workLocked && this.input.pointerActive) {
      const point = this.groundFromPointer(this.input.pointerX, this.input.pointerY);
      if (point) this.workPoint = { x: point.x, z: point.z };
    }
    const point = this.workPoint ?? { x: dock.x, z: dock.z + 8 };
    this.workRing.visible = true;
    this.workRing.position.set(point.x, groundHeight(point.x, point.z) + 0.22, point.z);
    this.workRing.scale.set(workAreaRadius(dock.level), workAreaRadius(dock.level), 1);
  }
  private upgradeNearest(): void {
    if (!this.state.is("playing")) return; const p = this.player.group.position; const b = this.buildings.nearest(p.x, p.z); if (!b) { this.audio.sfx("empty"); return; }
    if (!this.buildings.upgrade(b, (cost) => this.charge(cost))) { this.audio.sfx("empty"); this.ui.notify(this.t(b.level >= 3 ? "shop.max" : "toast.noCredits"), "warm"); return; }
    this.audio.sfx("upgrade"); this.ui.notify(this.t("toast.upgraded"), "warm"); this.effects.scan(b.x, b.z, groundHeight(b.x, b.z) + 0.2); this.effects.burst(b.x, groundHeight(b.x, b.z) + 1.4, b.z, COLORS.warm, 22); this.updateUI();
  }

  private repairNearest(): void {
    if (!this.state.is("playing")) return;
    const p = this.player.group.position; const b = this.buildings.nearest(p.x, p.z);
    if (!b || (!b.damaged && this.buildings.robotServiceCost(b) <= 0)) { this.audio.sfx("empty"); return; }
    const repaired = b.damaged
      ? this.buildings.repair(b.id, (cost) => this.charge(cost))
      : this.buildings.serviceRobots(b.id, (cost) => this.charge(cost));
    if (!repaired) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.noCredits"), "warm"); return; }
    this.audio.sfx("repair"); this.ui.notify(this.t("toast.repaired"), "warm");
    this.effects.burst(b.x, groundHeight(b.x, b.z) + 1.2, b.z, COLORS.cyan, 24);
    this.saveGame(); this.updateUI();
  }

  private moveNearest(): void {
    const p = this.player.group.position; const b = this.buildings.nearest(p.x, p.z); if (!b) return;
    for (const child of [...this.ghost.children]) disposeObject(child, true); this.ghost.clear(); this.ghost.add(this.buildings.createGhost(b.type));
    this.relocating = b.id; this.buildMode = b.type; this.railSource = null; this.input.mode = "build"; this.input.cameraRotate = false;
    this.ghost.visible = true; this.railPreview.visible = false; this.ui.notify(this.t("toast.moveMode"), "info"); this.updateUI();
  }
  private demolishNearest(): void {
    const p = this.player.group.position; const b = this.buildings.nearest(p.x, p.z); if (!b) return;
    this.demolishById(b.id); this.updateUI();
  }
  private demolishById(id: number): boolean {
    const existing = this.buildings.byId(id); if (!existing) return false;
    const refund = this.buildings.demolitionRefund(existing);
    this.rails.removeBuilding(id, true); const removed = this.buildings.demolish(id); if (!removed) return false;
    this.credits += refund; this.audio.sfx("build"); this.effects.burst(removed.x, groundHeight(removed.x, removed.z) + 1, removed.z, COLORS.orange, 22);
    this.ui.notify(`${this.t("toast.demolished")} · +${refund} ◈`, "warm"); this.saveGame(); return true;
  }

  private buyExtraRobot(buildingId: number): boolean {
    const bought = this.buildings.buyExtraRobot(buildingId, (cost) => this.charge(cost));
    if (!bought) { this.audio.sfx("empty"); this.ui.notify(this.t("toast.noCredits"), "warm"); return false; }
    this.audio.sfx("upgrade"); this.ui.notify(this.t("toast.robot"), "warm");
    this.saveGame(); this.updateQuest(); this.updateUI(); return true;
  }

  private setRobotZone(buildingId: number, slot: number, auto: boolean, range: number, x?: number, z?: number): boolean {
    const building = this.buildings.byId(buildingId); const robot = building?.robots.find((unit) => unit.slot === slot);
    if (!building || !robot) return false;
    const p = this.player.group.position;
    const centerX = auto ? undefined : x ?? (robot.zoneAuto ? p.x : robot.zoneX);
    const centerZ = auto ? undefined : z ?? (robot.zoneAuto ? p.z : robot.zoneZ);
    const changed = this.buildings.setRobotZone(buildingId, slot, auto, centerX, centerZ, range);
    if (changed) { this.audio.sfx("ui"); this.saveGame(); this.updateUI(); }
    return changed;
  }

  private setRobotZoneMode(buildingId: number, slot: number, mode: RobotZoneMode, chunkId?: number): boolean {
    const building = this.buildings.byId(buildingId); const robot = building?.robots.find((unit) => unit.slot === slot);
    if (!building || !robot || building.type !== "sweeper") return false;
    let x: number | undefined; let z: number | undefined; let range: number | undefined; let selectedChunk: number | undefined;
    if (mode === "custom") {
      selectedChunk = chunkId !== undefined && chunkId >= 0 && chunkId < this.snow.chunkColumns ** 2 ? chunkId : robot.activeChunk >= 0 ? robot.activeChunk : this.snow.chunkAt(robot.zoneX, robot.zoneZ);
      const center = this.snow.chunkCenter(selectedChunk); x = center.x; z = center.z; range = this.snow.chunkSize * 0.76;
    }
    const changed = this.buildings.setRobotZoneMode(buildingId, slot, mode, x, z, range);
    if (changed) {
      if (selectedChunk !== undefined) { robot.chunkIds = [selectedChunk]; robot.activeChunk = selectedChunk; robot.chunkProgress = this.snow.chunkView(selectedChunk).progress; }
      this.audio.sfx("ui"); this.saveGame(); this.updateUI();
    }
    return changed;
  }

  private clearBuildingPad(x: number, z: number, radius: number): void {
    this.snow.clear(x, z, radius + 0.9, 4);
  }

  private updateStorm(dt: number): void {
    if (this.stormPhase === "calm" && this.runTime >= this.nextStormAt - GAME.stormWarning) {
      this.stormPhase = "warning"; this.audio.sfx("warning");
      this.ui.notify(this.t(this.buildings.exposedSweeperCount() > 0 ? "storm.warningChoice" : "storm.warning"), "danger");
    }
    if (this.stormPhase === "warning") {
      this.stormTimer = Math.max(0, this.nextStormAt - this.runTime);
      if (this.runTime >= this.nextStormAt) {
        this.stormCount++;
        const inSevereWindow = this.stormCount >= this.nextSevereStorm;
        this.severeStorm = this.forceNextSevere || (inSevereWindow && this.random() < 0.72);
        this.forceNextSevere = false;
        if (inSevereWindow) this.nextSevereStorm = this.stormCount + 5 + Math.floor(this.random() * 3);
        this.stormPhase = "storm"; this.stormTimer = (this.severeStorm ? GAME.severeStormDuration : GAME.stormDuration) * (this.buildings.relayPowered("gale") ? 0.72 : 1); this.audio.sfx("warning");
        const filled = this.snow.stormBurst(this.buildings.heaterZones());
        const candidates = this.buildings.items.filter((b) => !b.damaged).map((b) => b.id);
        const severeDamage = this.severeStorm ? 1 + (this.random() < 0.7 ? 1 : 0) + (this.random() < 0.25 ? 1 : 0) : 0;
        const normalDamage = !this.severeStorm && this.random() < 0.38 ? 1 : 0;
        const damageCount = Math.min(candidates.length, severeDamage + normalDamage);
        for (let i = 0; i < damageCount; i++) {
          const index = Math.floor(this.random() * candidates.length); const id = candidates.splice(index, 1)[0]; this.buildings.damage(id);
        }
        const damageText = new Intl.NumberFormat(locale(this.settings.language)).format(damageCount);
        if (this.severeStorm) this.recordEvent(`${this.t("storm.severe")} · ${this.t("storm.damage")} ${damageText}`, "danger", "damage");
        else if (damageCount > 0) this.recordEvent(`${this.t("storm.active")} · ${this.t("storm.damage")} ${damageText}`, "danger", "damage");
        else if (filled > 0) this.recordEvent(this.t("storm.regrow"), "danger", "event");
      }
    } else if (this.stormPhase === "storm") {
      this.stormTimer -= dt;
      if (this.stormTimer <= 0) {
        this.stormPhase = "calm"; this.stormTimer = 0; this.severeStorm = false;
        this.nextStormAt = this.runTime + GAME.stormIntervalMin + this.random() * (GAME.stormIntervalMax - GAME.stormIntervalMin);
      }
    }
    const target = this.stormPhase === "storm" ? this.severeStorm ? 1.22 : 1 : this.stormPhase === "warning" ? 0.16 : 0;
    this.stormIntensity = THREE.MathUtils.lerp(this.stormIntensity, target, 1 - Math.exp(-dt * 1.7));
    if (this.stormPhase === "storm") {
      const p = this.player.group.position;
      this.snow.regrow(dt, this.stormIntensity, this.buildings.heaterZones(), { x: p.x, z: p.z, r: 14 });
    }
  }

  private updatePrompt(): void {
    const p = this.player.group.position; this.prompt = "";
    for (const core of this.world.cores) {
      const d = Math.hypot(core.x - p.x, core.z - p.z);
      if (!core.recovered && core.revealed && d < 2.4) { this.prompt = this.t("prompt.recover"); return; }
      if (!core.recovered && !core.revealed && d < 3.2) { this.prompt = this.t("prompt.clear"); return; }
    }
    const frozen = this.buildings.nearestFrozen(p.x, p.z); if (frozen) { this.prompt = `E · ${this.t("prompt.rescue")}`; return; }
    const relay = this.relays.nearest(p.x, p.z);
    if (relay) {
      const live = relay.repaired && this.buildings.relayPowered(relay.id);
      const detail = !relay.repaired ? `${relay.cost} ◈` : live ? `${relay.warmth}m ${this.t("relay.warmZone")}` : this.t("relay.needsPower");
      this.prompt = `E · ${this.t(relay.repaired ? `relay.${relay.id}.name` : "prompt.relayRepair")} · ${detail}`; return;
    }
    if (Math.hypot(p.x - this.world.depotPos.x, p.z - this.world.depotPos.z) < 3.3) { this.prompt = this.t(this.load > 0.001 ? "prompt.depot" : "prompt.empty"); return; }
    if (Math.hypot(p.x - this.world.fabricatorPos.x, p.z - this.world.fabricatorPos.z) < 3.2) { this.prompt = this.t("prompt.fabricator"); return; }
    const b = this.buildings.nearest(p.x, p.z); if (b) this.prompt = b.damaged
      ? `${this.t(`building.${b.type}.name`)} · E ${this.t("action.repair")} ${this.buildings.repairCost(b)} ◈`
      : `${this.t(`building.${b.type}.name`)} · E ${this.t(b.type === "sweeper" ? "prompt.depositSweeper" : b.type === "purifier" || b.type === "press" ? "prompt.deposit" : "prompt.collect")} · U ${this.t("action.upgrade")}`;
  }

  private confirmPowerPlacement(type: BuildingType, x: number, z: number, ignoreId?: number): boolean {
    const forecast = this.buildings.forecastPower(type, x, z, ignoreId);
    if (!forecast.consumesPower || forecast.connected) return true;
    this.audio.sfx("empty");
    this.ui.notify(this.t(forecast.reason === "network-full" ? "toast.networkFull" : "toast.noPowerHere"), "warm");
    return false;
  }
  private fundedSnowTarget(): { x: number; z: number } | null {
    const p = this.player.group.position; const avoided: Array<{ x: number; z: number }> = [];
    for (const radius of [28, 56, 84]) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const patch = this.snow.findBestPatch(p.x, p.z, radius, avoided);
        if (!patch) break;
        avoided.push(patch);
        if (patch.density < 0.22) continue;
        if (this.buildings.routeExists({ x: p.x, z: p.z }, patch)) return patch;
      }
    }
    return null;
  }
  private openPowerPad(type: BuildingType): { x: number; z: number } | null {
    const sources: Array<{ x: number; z: number; r: number }> = [{ x: GAME.baseCenter.x, z: GAME.baseCenter.z, r: GAME.basePowerRadius }];
    for (const generator of this.buildings.items) if (generator.type === "generator" && generator.powered && !generator.damaged) sources.push({ x: generator.x, z: generator.z, r: 9 + (generator.level - 1) * 4 });
    for (const source of sources) {
      if (!this.buildings.forecastPower(type, source.x, source.z).connected) continue;
      for (let ring = 0; ring <= Math.min(source.r - 1, 10); ring += 2) for (let step = 0; step < 8; step++) {
        const angle = step / 8 * Math.PI * 2;
        const x = Math.round(source.x + Math.cos(angle) * ring); const z = Math.round(source.z + Math.sin(angle) * ring);
        if (Math.hypot(x - source.x, z - source.z) > source.r - 0.4) continue;
        if (!this.buildings.validPlacement(x, z, BUILDINGS[type].radius)) continue;
        if (this.buildings.forecastPower(type, x, z).connected) return { x, z };
      }
    }
    return null;
  }
  private generatorGuide(): { x: number; z: number } {
    const forecast = this.buildings.forecastPower("heater", GAME.baseCenter.x, GAME.baseCenter.z);
    const upgradeable = this.buildings.items.find((building) => building.type === "generator" && building.level < 3);
    if (forecast.networkFull && upgradeable) return { x: upgradeable.x, z: upgradeable.z };
    // A generator beside the crowded base takes nearby machines and frees the six
    // base connections for heaters that are already inside base coverage.
    let fallback: { x: number; z: number } | null = null;
    for (let ring = 6; ring <= 18; ring += 2) for (let step = 0; step < 12; step++) {
      const angle = step / 12 * Math.PI * 2;
      const x = Math.round(GAME.baseCenter.x + Math.cos(angle) * ring); const z = Math.round(GAME.baseCenter.z + Math.sin(angle) * ring);
      if (!this.buildings.generatorReaches(x, z)) continue;
      if (!this.buildings.validPlacement(x, z, BUILDINGS.generator.radius)) continue;
      const covered = this.buildings.items.filter((building) => building.type !== "generator" && Math.hypot(building.x - x, building.z - z) <= 9).length;
      if (covered >= 2) return { x, z };
      if (covered >= 1 && !fallback) fallback = { x, z };
    }
    return fallback ?? (upgradeable ? { x: upgradeable.x, z: upgradeable.z } : { x: GAME.baseCenter.x - 8, z: GAME.baseCenter.z });
  }

  private updateGhost(): void {
    if (this.buildMode === "rail" && (this.railDraft || this.networkDraft)) {
      this.ghost.visible = false;
      if (this.railDraft) { const view = this.draftQuote(); if (view) this.drawRailPath(view.quote.points, view.valid); this.syncRailHandles(); }
      else if (this.networkDraft) this.drawRailPath(this.networkDraft.points, this.networkDraft.valid);
      return;
    }
    if (!this.buildMode || !this.input.pointerActive) { this.ghost.visible = false; this.railPreview.visible = false; this.buildCursor = null; return; }
    const point = this.groundFromPointer(this.input.pointerX, this.input.pointerY); if (!point) return;
    if (this.buildMode === "rail") {
      this.ghost.visible = false;
      const reach = this.input.isCoarse ? 3.6 : 2.7;
      const junction = this.rails.network.hit(point.x, point.z, reach);
      const netGhost = (from: NetEnd, to: NetEnd, fallback: [RailPathPoint, RailPathPoint]) => {
        const preview = this.rails.network.preview(from, to);
        if (preview.points.length >= 2) { this.drawRailPath(preview.points, preview.valid); return; }
        this.drawRailPath(fallback, false);
      };
      if (this.railSource !== null) {
        const source = this.buildings.byId(this.railSource); if (!source) return;
        const start = { x: source.x, z: source.z };
        if (junction) { netGhost({ buildingId: source.id, port: "out" }, { nodeId: junction.id }, [start, { x: junction.x, z: junction.z }]); return; }
        const target = this.resolveRailTarget(point.x, point.z, source.id);
        if (!target) { this.railPreview.visible = false; return; }
        const end = this.railEndpoint(target.id) ?? { x: target.x, z: target.z };
        if (!target.valid) { this.drawRailPath([start, end], false); return; }
        netGhost({ buildingId: source.id, port: "out" }, { buildingId: target.id, port: "in" }, [start, end]);
        return;
      }
      if (this.selectedJunction != null) {
        const view = this.rails.network.inspect(this.selectedJunction);
        if (!view) { this.selectedJunction = null; this.railPreview.visible = false; return; }
        const home = { x: view.x, z: view.z };
        if (junction && junction.id !== this.selectedJunction) { netGhost({ nodeId: this.selectedJunction }, { nodeId: junction.id }, [home, { x: junction.x, z: junction.z }]); return; }
        if (Math.hypot(point.x - GAME.depot.x, point.z - GAME.depot.z) <= 4.2) { netGhost({ nodeId: this.selectedJunction }, { buildingId: 0, port: "in" }, [home, { x: GAME.depot.x, z: GAME.depot.z - 1.7 }]); return; }
        const near = this.buildings.items.find((building) => (building.type === "sweeper" || building.type === "purifier" || building.type === "press") && Math.hypot(point.x - building.x, point.z - building.z) < 2.4);
        if (!near) { this.railPreview.visible = false; return; }
        const feed: [NetEnd, NetEnd] = [{ buildingId: near.id, port: "out" }, { nodeId: this.selectedJunction }];
        const drain: [NetEnd, NetEnd] = [{ nodeId: this.selectedJunction }, { buildingId: near.id, port: "in" }];
        const [first, second] = view.kind === "split" ? [drain, feed] : [feed, drain];
        const probe = this.rails.network.preview(first[0], first[1]);
        const chosen = probe.ok || probe.reason === "blocked" ? first : second;
        netGhost(chosen[0], chosen[1], [home, { x: near.x, z: near.z }]);
        return;
      }
      this.railPreview.visible = false; return;
    }
    const x = Math.round(point.x), z = Math.round(point.z); this.buildCursor = { x, z }; this.ghost.position.set(x, groundHeight(x, z) + 0.04, z); this.ghost.visible = true;
    const cableValid = this.buildMode !== "generator" || this.buildings.generatorReaches(x, z, this.relocating ?? undefined);
    const forecast = this.buildings.forecastPower(this.buildMode, x, z, this.relocating ?? undefined);
    const powerValid = !forecast.consumesPower || forecast.connected;
    const valid = cableValid && powerValid && this.buildings.validPlacement(x, z, BUILDINGS[this.buildMode].radius, this.relocating ?? undefined, this.player.group.position); const color = valid ? 0x66f0d7 : 0xff625f;
    this.ghost.traverse((object) => { if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) if ("color" in material) (material as THREE.MeshBasicMaterial).color.setHex(color); });
  }

  private update(dt: number): void {
    this.ui.setDetails(this.state.is("playing") && this.input.detailsHeld);
    const orbit = this.input.consumeOrbit();
    if (this.buildMode === "rail") this.cameraAzimuth -= orbit;
    if (this.input.consumeAction("BracketLeft")) this.cameraAzimuth -= 0.22;
    if (this.input.consumeAction("BracketRight")) this.cameraAzimuth += 0.22;
    if (this.input.consumeAction("KeyM")) this.toggleMute();
    if (this.cinematic.active && (this.input.consumeAction("Escape") || this.input.consumeAction("Space") || this.input.consumeAction("Enter") || this.input.consumeAction("KeyP"))) this.cinematic.skip();
    else if (this.tutorial.active) {
      if (this.input.consumeAction("Escape") || this.input.consumeAction("KeyP")) this.tutorial.skip();
      else if (this.input.consumeAction("Space") || this.input.consumeAction("Enter")) this.tutorial.next();
    }
    if (this.input.consumeAction("Escape") || this.input.consumeAction("KeyP")) {
      if (this.buildMode) this.cancelBuild(); else if (this.state.is("playing")) this.pause(); else if (this.state.is("paused")) this.resume(); else if (this.pausePanel === "settings") this.closePanel();
    }
    if ((this.input.consumeAction("Space") || this.input.consumeAction("Enter")) && !this.state.is("playing") && this.pausePanel !== "settings") {
      if (this.state.is("title") || this.state.is("victory") || this.state.is("gameover")) this.startRun();
    }
    if (this.state.is("title")) { this.visualTime += dt * 0.45; this.effects.update(dt, 0, false); return; }
    if (!this.state.is("playing")) return;
    if (this.cinematic.active) { this.visualTime += dt; this.cinematic.update(dt); this.effects.update(dt, 0, false); return; }
    if (this.tutorial.active) { this.visualTime += dt * 0.2; this.tutorial.updateFrame(); this.effects.update(dt, 0, false); return; }
    this.previousPose.position.copy(this.currentPose.position); this.previousPose.yaw = this.currentPose.yaw;
    this.runTime += dt; this.visualTime += dt; this.uiTimer -= dt; this.saveTimer += dt; this.scannerCooldown = Math.max(0, this.scannerCooldown - dt);
    this.signalAge += dt; if (this.signalAge > 9) this.scannerSignal.strength = 0;
    this.interactionAnim = Math.max(0, this.interactionAnim - dt * 2.4);
    if (this.input.consumeAction("KeyQ")) this.scan(); if (this.input.consumeAction("KeyE")) this.interact();
    if (this.input.consumeAction("KeyT")) this.openUpgrades(); if (this.input.consumeAction("KeyU")) this.upgradeNearest(); if (this.input.consumeAction("KeyR")) this.selectRail();
    for (let i = 0; i < TOOLS.length; i++) if (this.input.consumeAction(`Digit${i + 1}`)) this.selectTool(TOOLS[i].id);
    if ((this.railDraft || this.strokePlan) && this.input.consumeAction("Enter")) this.confirmRailDraft();
    if (this.workDock != null && this.input.consumeAction("Enter")) this.confirmWorkArea();
    if (this.workDock != null && this.input.consumeAction("Escape")) this.cancelWorkArea();
    this.followRailDrag();
    let click; while ((click = this.input.consumeClick())) {
      if (this.workDock != null) {
        if (click.button === 2) this.cancelWorkArea();
        else { const point = this.groundFromPointer(click.x, click.y); if (point) { this.workPoint = { x: point.x, z: point.z }; this.workLocked = true; this.audio.sfx("ui"); this.updateUI(); } }
        continue;
      }
      if (click.button === 2) { if (this.buildMode !== "rail") this.cancelBuild(); }
      else if (this.buildMode === "rail") { if (!this.input.pointerDown) this.tapRail(click.x, click.y); }
      else if (this.buildMode) { const point = this.groundFromPointer(click.x, click.y); if (point) this.placeAt(point.x, point.z); }
    }
    this.followWorkAim();
    this.followStroke();
    const zoom = this.input.consumeZoom(); if (zoom) this.cameraZoom = THREE.MathUtils.clamp(this.cameraZoom + zoom * 0.08, 0.72, 1.45);
    this.updateStorm(dt);
    const p = this.player.group.position; let mx = this.input.moveX, mz = -this.input.moveZ; const length = Math.hypot(mx, mz); const moving = length > 0.08 && !this.buildMode;
    const clearingHeld = this.input.clearHeld || this.debugClear;
    this.sprinting = moving && this.input.sprintHeld && !clearingHeld;
    const equipped = this.toolStats;
    const depth = THREE.MathUtils.clamp(this.snow.sample(p.x, p.z), 0, 1);
    const moveSpeed = this.actualSpeed * (clearingHeld ? equipped.pace : 1) * (1 - (1 - equipped.wade) * depth);
    if (moving) {
      mx /= Math.max(1, length); mz /= Math.max(1, length); this.walkTime += dt * moveSpeed;
      this.facing.set(mx, 0, mz).normalize();
    }
    const stormPush = !moving && this.stormPhase === "storm" ? GAME.stormWindPush * this.stormIntensity * dt * 0.28 : 0;
    const oldPX = p.x, oldPZ = p.z;
    this.physics.move(p, moving ? mx * moveSpeed * dt : GAME.windX * stormPush, moving ? mz * moveSpeed * dt : GAME.windZ * stormPush, dt);
    if (moving) this.stepDistance += Math.hypot(p.x - oldPX, p.z - oldPZ);
    if (!this.input.isCoarse && this.input.pointerActive && this.input.pointerClearing && !this.buildMode) {
      const point = this.groundFromPointer(this.input.pointerX, this.input.pointerY);
      if (point) { const dx = point.x - p.x, dz = point.z - p.z; if (Math.hypot(dx, dz) > 0.35) this.facing.set(dx, 0, dz).normalize(); }
    }
    const targetYaw = Math.atan2(this.facing.x, this.facing.z); this.player.group.rotation.y = lerpAngle(this.player.group.rotation.y, targetYaw, 1 - Math.exp(-dt * 13));
    const groundY = Math.max(this.physics.footY, this.snow.heightAt(p.x, p.z)); p.y = THREE.MathUtils.lerp(p.y, groundY, 1 - Math.exp(-dt * 16));
    if (this.stepDistance >= 0.58) {
      this.stepDistance = 0; if (this.snow.sample(p.x, p.z) > 0.12) this.effects.footprint(p.x, this.snow.heightAt(p.x, p.z), p.z, this.player.group.rotation.y, this.footSide);
      this.footSide *= -1;
    }
    const ahead = groundHeight(p.x + this.facing.x * 0.5, p.z + this.facing.z * 0.5);
    this.player.visual.rotation.x = THREE.MathUtils.lerp(this.player.visual.rotation.x, THREE.MathUtils.clamp((groundHeight(p.x, p.z) - ahead) * 0.3, -0.16, 0.16), 0.18);
    this.player.visual.rotation.z = THREE.MathUtils.lerp(this.player.visual.rotation.z, 0, 0.18);
    const brushDistance = this.toolStats.distance;
    this.brushPoint.set(p.x + this.facing.x * brushDistance, 0.16, p.z + this.facing.z * brushDistance); this.brushPoint.y = this.snow.heightAt(this.brushPoint.x, this.brushPoint.z) + 0.16;
    this.effects.aim(this.selectedTool, p.x, p.z, this.brushPoint.x, this.brushPoint.z, this.brushPoint.y, this.clearRadius, !this.buildMode);
    let clearing = false;
    if (clearingHeld && this.load < this.capacity - 0.01 && !this.buildMode && this.toolHealth[this.selectedTool] > 0) {
      const removed = this.snow.clear(this.brushPoint.x, this.brushPoint.z, this.clearRadius, 0, (density) => toolClearRate(equipped, density) * dt);
      if (removed > 0) {
        const gained = Math.min(removed * Math.min(1, this.toolYield), this.capacity - this.load); this.raw += gained; this.collectedRaw += gained; clearing = true;
        const previousHealth = this.toolHealth[this.selectedTool];
        this.toolHealth[this.selectedTool] = Math.max(0, previousHealth - 0.065 * equipped.wear * dt);
        if (previousHealth > 0 && this.toolHealth[this.selectedTool] <= 0) { this.audio.sfx("warning"); this.ui.notify(this.t("toast.toolBroken"), "danger"); }
        this.effects.spray(this.brushPoint.x, this.brushPoint.y + 0.12, this.brushPoint.z, this.facing.x, this.facing.z);
      }
    }
    this.audio.setClearing(clearing); this.character.update(dt, moving, clearing, this.selectedTool, this.interactionAnim > 0.82, this.sprinting);
    const activeTool = this.player.tools[this.selectedTool]; const spin = activeTool.getObjectByName("spin");
    if (spin && (clearing || this.selectedTool === "blower")) spin.rotation[this.selectedTool === "brush" ? "x" : "z"] += dt * (clearing ? 18 : 2);

    if (this.buildings.warmingAt(p.x, p.z)) this.heat = Math.min(100, this.heat + GAME.heatRecharge * dt);
    else { const drain = this.stormPhase === "storm" ? GAME.stormHeatDrain : GAME.heatDrain; this.heat = Math.max(0, this.heat - drain * this.heatFactor * (this.sprinting ? GAME.sprintHeatMultiplier : 1) * (clearingHeld ? equipped.heat : 1) * dt); }
    if (this.heat >= 45) this.heatWarningArmed = true;
    else if (this.heatWarningArmed && this.heat < 28 && this.heat > 0) { this.heatWarningArmed = false; this.ui.notify(this.t("toast.heatLow"), "danger"); }
    for (const core of this.world.cores) if (!core.scanned && !core.recovered && this.snow.sample(core.x, core.z) < 0.22 && Math.hypot(core.x - p.x, core.z - p.z) < 3.2) { core.scanned = true; this.ui.notify(this.t("toast.discovered"), "info"); }
    this.world.updateCores(this.snow);
    this.buildings.setRelaySites(this.relays.items.map((relay) => ({ id: relay.id, x: relay.x, z: relay.z, repaired: relay.repaired })));
    const relayLive = (id: RelayId) => this.relays.repaired(id) && this.buildings.relayPowered(id);
    this.buildings.setRelayBoosts(relayLive("servo") ? 1.3 : 1, relayLive("foundry") ? 1.3 : 1);
    this.buildings.setAuxiliaryZones(this.relays.items.filter((relay) => relayLive(relay.id)).map((relay) => ({ x: relay.x, z: relay.z, r: relay.warmth })));
    this.buildings.update(dt, this.snow, this.stormIntensity, p, p);
    for (const relay of this.relays.items) this.relays.setLive(relay.id, this.buildings.relayPowered(relay.id));
    this.rails.update(dt); this.updateQuest(); this.updatePrompt(); this.updateGhost();
    const frozenCount = this.buildings.frozenCount();
    if (frozenCount < this.lastFrozenCount) { const p2 = this.player.group.position; this.ui.notify(this.t("toast.robotSaved"), "warm"); this.effects.burst(p2.x, p2.y + 1, p2.z, COLORS.cyan, 22); }
    this.lastFrozenCount = frozenCount;
    this.effects.update(dt, this.stormIntensity, clearing, p.x, p.z); if (this.heat <= 0) this.gameOver();
    this.currentPose.position.copy(this.player.group.position); this.currentPose.yaw = this.player.group.rotation.y;
    if (this.saveTimer >= 10) { this.saveTimer = 0; this.saveGame(); }
    if (this.uiTimer <= 0) { this.uiTimer = 0.1; this.audio.setStorm(this.stormIntensity); this.updateUI(); }
  }

  private segmentHitsCircle(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, radius: number): boolean {
    const abx = bx - ax; const abz = bz - az; const len2 = abx * abx + abz * abz;
    const t = len2 < 1e-6 ? 0 : THREE.MathUtils.clamp(((cx - ax) * abx + (cz - az) * abz) / len2, 0, 1);
    const dx = ax + abx * t - cx; const dz = az + abz * t - cz;
    return dx * dx + dz * dz < radius * radius;
  }
  /** Pull the camera inward and upward when a backdrop mountain crosses the view. */
  private fitCamera(px: number, pz: number, mobile: boolean, zoom: number): { x: number; y: number; z: number } {
    let horizontal = (mobile ? Math.hypot(17, 21) : Math.hypot(14, 18)) * zoom;
    let height = (mobile ? 23 : 20) * zoom;
    for (let attempt = 0; attempt < 6; attempt++) {
      const x = px + Math.sin(this.cameraAzimuth) * horizontal; const z = pz + Math.cos(this.cameraAzimuth) * horizontal;
      const blocked = this.world.vista.some((mountain) => this.segmentHitsCircle(px, pz, x, z, mountain.x, mountain.z, mountain.r + 1.4));
      if (!blocked) return { x, y: height, z };
      horizontal *= 0.74; height += 1.8;
    }
    return { x: px + Math.sin(this.cameraAzimuth) * horizontal, y: height, z: pz + Math.cos(this.cameraAzimuth) * horizontal };
  }

  private render(alpha: number): void {
    const now = performance.now(); const frameDt = Math.min(0.25, (now - this.lastFrameTime) / 1000); this.lastFrameTime = now;
    this.world.update(this.visualTime, this.stormIntensity); this.relays.update(frameDt, this.visualTime);
    if (this.cinematic.active) this.renderPosition.copy(this.player.group.position);
    else this.renderPosition.lerpVectors(this.previousPose.position, this.currentPose.position, THREE.MathUtils.clamp(alpha, 0, 1));
    const p = this.renderPosition;
    this.player.visual.position.copy(p).sub(this.player.group.position);
    this.player.visual.rotation.y = this.cinematic.active ? 0 : lerpAngle(0, this.previousPose.yaw - this.currentPose.yaw, 1 - THREE.MathUtils.clamp(alpha, 0, 1));
    if (this.cinematic.active) {
      this.desiredCamera.copy(this.cinematic.cameraPosition); this.cameraTarget.copy(this.cinematic.cameraTarget);
    } else if (this.state.is("title")) {
      const a = this.visualTime * 0.1 + 0.6; this.desiredCamera.set(Math.sin(a) * 36, 23, 8 + Math.cos(a) * 36); this.cameraTarget.set(0, 1.5, 9);
    } else {
      const mobile = this.input.isCoarse; const z = this.cameraZoom;
      const fitted = this.fitCamera(p.x, p.z, mobile, z);
      this.desiredCamera.set(fitted.x, fitted.y, fitted.z);
      this.cameraTarget.set(p.x, p.y + 0.9, p.z - 1.3);
    }
    this.cameraControls.smoothTime = this.cinematic.active ? 0.16 : this.state.is("title") ? 0.4 : 0.1;
    this.cameraControls.setPosition(this.desiredCamera.x, this.desiredCamera.y, this.desiredCamera.z, true);
    this.cameraControls.moveTo(this.cameraTarget.x, this.cameraTarget.y, this.cameraTarget.z, true);
    this.cameraControls.update(frameDt); this.currentTarget.copy(this.cameraTarget);
    if (this.settings.cameraShake) {
      const gust = this.stormIntensity * this.stormIntensity * 0.07;
      this.camera.position.x += Math.sin(this.visualTime * 19) * gust; this.camera.position.y += Math.cos(this.visualTime * 23) * gust * 0.5;
      if (this.shakeStrength > 0.001) { this.camera.position.x += Math.sin(this.visualTime * 67) * this.shakeStrength; this.camera.position.y += Math.cos(this.visualTime * 53) * this.shakeStrength * 0.5; this.shakeStrength *= Math.exp(-7.5 * frameDt); }
    }
    this.sun.position.set(p.x - 32, 58, p.z + 24); this.sun.target.position.set(p.x, 0, p.z); this.sun.target.updateMatrixWorld();
    this.fog.near = 48 - this.stormIntensity * 31; this.fog.far = 132 - this.stormIntensity * 79; this.sun.intensity = 2.35 - this.stormIntensity * 1.3;
    this.renderer.render(this.scene, this.camera);
    this.fpsFrames++; this.fpsElapsed += frameDt;
      if (this.fpsElapsed >= 2) {
      this.measuredFps = this.fpsFrames / this.fpsElapsed;
      this.considerQuality(this.measuredFps, this.tabHidden || document.hidden);
      this.fpsFrames = 0; this.fpsElapsed = 0;
    }
    window.__GAME_READY__ = true;
  }

  private railGuideTarget(): { x: number; z: number } {
    const sources = (["sweeper", "purifier", "press"] as const).flatMap((type) => this.buildings.items.filter((b) => b.type === type));
    const open = sources.find((b) => !this.rails.hasSource(b.id));
    const chosen = open ?? sources[0];
    return chosen ? { x: chosen.x, z: chosen.z } : { x: 3, z: -2 };
  }

  private objective(): ObjectiveView {
    const p = this.player.group.position; let x = 0, z = -4, key = "objective.snow";
    const purifier = this.buildings.items.find((b) => b.type === "purifier"); const press = this.buildings.items.find((b) => b.type === "press");
    switch (this.questIndex) {
      case 0: if (this.raw > 0) { x = GAME.depot.x; z = GAME.depot.z; key = "objective.depot"; } break;
      case 1:
        if (this.credits < BUILDINGS.purifier.cost && this.buildings.count("purifier") === 0) {
          const snow = this.fundedSnowTarget();
          if (snow) { x = snow.x; z = snow.z; key = "objective.snowFund"; break; }
        }
        x = 3; z = -2; key = "objective.purifierBuild"; break;
      case 2: x = purifier?.x ?? 3; z = purifier?.z ?? -2; key = "objective.produce"; break;
      case 3: x = GAME.depot.x; z = GAME.depot.z; key = "objective.depot"; break;
      case 4: x = -3; z = -3; key = "objective.pressBuild"; break;
      case 5: if (this.ice > 0 || !press) { x = GAME.depot.x; z = GAME.depot.z; key = "objective.depot"; } else { x = press.x; z = press.z; key = "objective.press"; } break;
      case 6: { const source = this.railGuideTarget(); x = source.x; z = source.z; key = "objective.rail"; break; }
      case 7: x = 8; z = -6; key = "objective.robot"; break;
      case 8: {
        const site = this.world.heaterSites.find((candidate) => !this.buildings.items.some((building) => building.type === "heater" && Math.hypot(building.x - candidate.x, building.z - candidate.z) < 2.4) && this.buildings.forecastPower("heater", candidate.x, candidate.z).connected);
        const pad = site ?? this.openPowerPad("heater");
        if (pad) { x = pad.x; z = pad.z; key = "objective.heater"; }
        else { const generator = this.generatorGuide(); x = generator.x; z = generator.z; key = "objective.generator"; }
        break;
      }
      case 9:
        if (!this.cleanupCertified) { const patch = this.cleanupGuide(); x = patch?.x ?? p.x; z = patch?.z ?? p.z; key = "objective.cleanup"; }
        else if (this.recovered < 3) { const core = this.world.cores.find((c) => !c.recovered); x = core?.x ?? p.x; z = core?.z ?? p.z; key = "objective.evidence"; }
        else { x = GAME.baseCenter.x; z = GAME.baseCenter.z; key = "objective.base"; }
        break;
    }
    return { x, z, key, distance: Math.hypot(x - p.x, z - p.z) };
  }

  private get salesPerMinute(): number {
    this.salesHistory = this.salesHistory.filter((sale) => sale.time > this.runTime - 60 && sale.time <= this.runTime && Number.isFinite(sale.amount));
    return this.salesHistory.reduce((sum, sale) => sum + sale.amount, 0);
  }

  private buildingLabel(id: number): string {
    if (id === 0) return this.t("rail.depot");
    const building = id > 0 ? this.buildings.byId(id) : undefined;
    return building ? this.t(`building.${building.type}.name`) : "—";
  }
  private junctionView(): GameSnapshot["junction"] {
    if (this.selectedJunction == null || this.networkDraft) return null;
    const view = this.rails.network.inspect(this.selectedJunction); if (!view) return null;
    return { id: view.id, kind: view.kind, policy: view.policy, ratio: view.ratio, backlog: view.backlog, sentA: view.sentA, sentB: view.sentB, destA: this.buildingLabel(view.destA), destB: this.buildingLabel(view.destB), blocked: view.blocked };
  }
  private railEditorView(): GameSnapshot["railEditor"] {
    const stroke = this.strokePlan;
    if (stroke && this.buildMode === "rail") return {
      sourceId: Math.max(0, stroke.sourceId), destinationId: Math.max(0, stroke.destinationId),
      sourceName: this.endpointLabel(stroke.sourceId), destinationName: this.endpointLabel(stroke.destinationId),
      kind: stroke.kind ?? "raw", points: Math.max(0, stroke.points.length - 2), valid: stroke.ok, blocked: !stroke.ok,
      cost: stroke.cost, extra: stroke.cost, selected: null, existing: stroke.reason === "reuse", network: true,
    };
    const net = this.networkDraft;
    if (net && this.buildMode === "rail") return { sourceId: 0, destinationId: 0, sourceName: net.sourceName, destinationName: net.destinationName, kind: net.kind, points: 0, valid: net.valid, blocked: !net.valid, cost: net.cost, extra: net.cost, selected: null, existing: false, network: true };
    const draft = this.railDraft;
    if (!draft || this.buildMode !== "rail") return null;
    const view = this.draftQuote(); if (!view) return null;
    const destination = draft.destinationId === 0 ? null : this.buildings.byId(draft.destinationId);
    const kind = this.buildings.cargoKind(view.source);
    if (!kind) return null;
    return {
      sourceId: draft.sourceId, destinationId: draft.destinationId,
      sourceName: this.t(`building.${view.source.type}.name`),
      destinationName: destination ? this.t(`building.${destination.type}.name`) : this.t("rail.depot"),
      kind, points: Math.max(0, draft.controls.length - 2), valid: view.valid, blocked: view.blocked,
      cost: view.quote.cost, extra: view.extra, selected: draft.selected, existing: draft.existing, network: false,
    };
  }
  private snapshot(): GameSnapshot {
    const views = this.buildings.views(this.player.group.position.x, this.player.group.position.z);
    for (const view of views) view.dispatching = this.rails.hasSource(view.id);
    const nearest = this.buildings.nearest(this.player.group.position.x, this.player.group.position.z);
    const questTarget = QUESTS[this.questIndex].target;
    const questValue = Math.min(questTarget, this.questProgress());
    const questProgress = questTarget - questValue <= 0.01 ? questTarget : questValue;
    return {
      state: this.state.state, pausePanel: this.pausePanel, language: this.settings.language,
      raw: this.raw, purified: this.purified, ice: this.ice, capacity: this.capacity, load: this.load, tankReady: this.tankReady, credits: this.credits, heat: this.heat, power: this.power, cores: this.recovered,
      coreViews: this.world.cores.map((c) => ({ id: c.id, scanned: c.scanned, revealed: c.revealed, recovered: c.recovered })),
      scannerCooldown: this.scannerCooldown, scannerCooldownMax: this.scannerMax, scannerRadius: this.scannerRadius, scannerSignal: { ...this.scannerSignal },
      radarCharges: this.radarCharges, radarMaxCharges: this.radarMaxCharges, radarBatteryCost: this.radarBatteryCost,
      stormPhase: this.stormPhase, stormTimer: this.stormTimer,
      stormEta: Math.max(0, this.nextStormAt - this.runTime), stormCycle: Math.max(0, this.nextSevereStorm - this.stormCount),
      stormCount: this.stormCount, severeStorm: this.severeStorm, galeLive: this.buildings.relayPowered("gale"),
      radarActive: this.radarActive, sprinting: this.sprinting, worldSize: GAME.worldSize,
      cleanupPercent: this.snow.cleanupPercent, cleanupCertified: this.cleanupCertified, rawSold: this.rawSold, salesPerMinute: this.salesPerMinute, prompt: this.prompt, runTime: this.runTime, produced: this.produced, sold: this.sold, iceSold: this.iceSold, speed: this.actualSpeed,
      upgrades: { ...this.upgrades }, tools: { ...this.tools }, toolHealth: { ...this.toolHealth }, selectedTool: this.selectedTool, muted: this.audio.muted, lowQuality: this.lowQuality, hasSave: this.hasSave,
      quest: { index: this.questIndex, total: QUESTS.length, progress: questProgress, target: questTarget, reward: QUESTS[this.questIndex].reward },
      objective: this.objective(), buildings: views, nearestBuilding: nearest ? views.find((v) => v.id === nearest.id)! : null,
      buildMode: this.buildMode, railSource: this.railSource, railCount: this.rails.items.length, railEditor: this.railEditorView(),
      junction: this.junctionView(), railSelection: this.railSelectionView(), railTools: this.buildMode === "rail" && !this.railEditorView() && !this.networkDraft && !this.strokePlan,
      buildPreview: this.buildMode && this.buildMode !== "rail" && this.buildCursor ? { ...this.buildings.forecastPower(this.buildMode, this.buildCursor.x, this.buildCursor.z, this.relocating ?? undefined), ...this.buildCursor } : null,
      workAim: this.workDock == null ? null : { buildingId: this.workDock, x: this.workPoint?.x ?? 0, z: this.workPoint?.z ?? 0, radius: workAreaRadius(this.buildings.byId(this.workDock)?.level ?? 1), locked: this.workLocked },
      robotCount: this.buildings.robotCount(), frozenRobots: this.buildings.frozenCount(), settings: { ...this.settings },
      chunks: this.snow.chunkViews(), chunkSize: this.snow.chunkSize, chunkColumns: this.snow.chunkColumns,
      relays: this.relays.views(this.player.group.position.x, this.player.group.position.z).map((relay) => ({ ...relay, powered: this.buildings.relayPowered(relay.id) })), events: this.events.map((event) => ({ ...event })),
      windX: GAME.windX, windZ: GAME.windZ,
      cinematic: { active: this.cinematic.active, time: this.cinematic.time, duration: this.cinematic.duration },
      tutorial: this.tutorial.view(),
    };
  }
  private updateUI(): void { const snapshot = this.snapshot(); this.world.setObjective(snapshot.objective.x, snapshot.objective.z, snapshot.state === "playing"); this.world.setHeaterSitesVisible(snapshot.state === "playing" && snapshot.quest.index === 8); this.ui.update(snapshot); }
  private resize(): void {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight, false);
    this.input.resetAll(); this.tutorial.updateFrame();
    this.ui.showState(this.state.state, this.pausePanel);
    this.updateUI();
  }

  private updateSetting<K extends keyof SettingsView>(key: K, value: SettingsView[K]): void {
    this.settings[key] = value; storage.set("settings-v2", this.settings);
    if (key === "volume") this.audio.setVolume(this.settings.volume);
    if (key === "musicTrack") this.audio.setMusicTrack(this.settings.musicTrack);
    if (key === "musicEnabled") this.audio.setMusicEnabled(this.settings.musicEnabled);
    if (key === "musicVolume") this.audio.setMusicVolume(this.settings.musicVolume);
    if (key === "sfxEnabled") this.audio.setSfxEnabled(this.settings.sfxEnabled);
    if (key === "sfxVolume") this.audio.setSfxVolume(this.settings.sfxVolume);
    if (key === "ambienceEnabled") this.audio.setAmbienceEnabled(this.settings.ambienceEnabled);
    if (key === "ambienceVolume") this.audio.setAmbienceVolume(this.settings.ambienceVolume);
    if (key === "quality") { this.lowQuality = value === "low" || (value === "auto" && this.qualityLockedLow()); this.fpsLowStreak = 0; this.fpsHighStreak = 0; this.qualityHold = 0; this.applyQuality(); }
    if (key === "particles") this.effects.setParticles(this.settings.particles);
    if (key === "language") { this.ui.applyLanguage(this.settings.language); this.world.setLanguage(this.settings.language); }
    this.updateUI();
  }
  private qualityLockedLow(): boolean {
    return /swiftshader|llvmpipe|software/i.test(this.gpuName) || new URLSearchParams(location.search).has("low");
  }
  private considerQuality(fps: number, hidden: boolean): void {
    const next = advanceQualityLatch(
      { low: this.lowQuality, lowStreak: this.fpsLowStreak, highStreak: this.fpsHighStreak, hold: this.qualityHold },
      { fps, hidden, locked: this.settings.quality !== "auto" || this.qualityLockedLow() },
    );
    this.fpsLowStreak = next.lowStreak; this.fpsHighStreak = next.highStreak; this.qualityHold = next.hold;
    if (next.low !== this.lowQuality) { this.lowQuality = next.low; this.applyQuality(); }
  }
  private applyQuality(): void {
    this.renderer.setPixelRatio(this.lowQuality ? 1 : Math.min(devicePixelRatio, this.input?.isCoarse ? 1.5 : 2));
    this.renderer.shadowMap.enabled = !this.lowQuality; this.sun.castShadow = !this.lowQuality; this.effects.lowQuality = this.lowQuality; this.effects.setParticles(this.settings.particles);
  }

  private readSave(): SaveData | null {
    const save = storage.get<LegacySave | null>(GAME.saveKey, null);
    this.migrationRadarRefund = false;
    if (!save || ![2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(save.version) || !Array.isArray(save.snow) || !Array.isArray(save.rails) || !Array.isArray(save.buildings) || !Array.isArray(save.cores) || !Number.isFinite(save.runTime)) return null;
    const levels = blankUpgrades(); for (const id of Object.keys(levels) as UpgradeId[]) levels[id] = THREE.MathUtils.clamp(Number(save.upgrades?.[id] === true ? 1 : save.upgrades?.[id]) || 0, 0, 3);
    const legacyTankLevel = save.version < 9 ? THREE.MathUtils.clamp(Math.floor(Number(save.upgrades?.tank === true ? 1 : save.upgrades?.tank) || 0), 0, 3) : 0;
    const legacyTankRefund = [70, 150, 280].slice(0, legacyTankLevel).reduce((sum, cost) => sum + cost, 0);
    const tools = { ...blankTools(), ...save.tools }; const toolHealth = fullToolHealth();
    for (const id of Object.keys(tools) as ToolId[]) {
      tools[id] = THREE.MathUtils.clamp(Number(tools[id]) || 0, 0, 4);
      toolHealth[id] = THREE.MathUtils.clamp(Number(save.toolHealth?.[id] ?? 100) || 0, 0, 100);
    }
    const rails = save.rails.filter((rail) => rail && Array.isArray(rail.path)).map((rail) => ({ ...rail, destinationId: rail.destinationId ?? 0 }));
    const salesHistory = (save.salesHistory ?? []).filter((sale) => sale && Number.isFinite(sale.time) && Number.isFinite(sale.amount) && sale.time > save.runTime - 60 && sale.time <= save.runTime).slice(-500);
    const selectedTool = save.selectedTool && tools[save.selectedTool] > 0 ? save.selectedTool : "hands";
    this.migrationRadarRefund = save.version < 9 && !!save.radarActive;
    const relays = [...new Set((save.relays ?? []).filter((id): id is RelayId => id === "gale" || id === "servo" || id === "foundry"))];
    const eventCandidates = (save.events ?? []).filter((event) => event && typeof event.text === "string" && Number.isFinite(event.time) && ["event", "clue", "damage", "power"].includes(event.kind));
    const retainedEvents = [...eventCandidates.filter((event) => event.kind !== "clue").slice(-80), ...eventCandidates.filter((event) => event.kind === "clue")];
    const events = retainedEvents.map((event, index) => ({
      id: Number.isFinite(event.id) ? Math.max(1, Math.floor(event.id)) : index + 1,
      time: Math.max(0, event.time), text: event.text.slice(0, 1200),
      tone: event.tone === "warm" || event.tone === "danger" ? event.tone : "info", kind: event.kind,
      key: typeof event.key === "string" ? event.key : undefined,
      params: event.params && typeof event.params === "object" ? { ...event.params } : undefined,
    }));
    return {
      ...save, version: 11, selectedTool, toolHealth, salesHistory, relays, events,
      rawSold: Math.max(0, save.rawSold ?? (save.questIndex > 0 ? 5 : Math.min(5, save.sold / 1.5))),
      cleanupCertified: save.cleanupCertified ?? false,
      scannerCooldown: Math.max(0, save.scannerCooldown ?? 0), status: save.status ?? "playing",
      credits: Math.max(0, Number(save.credits) || 0) + (this.migrationRadarRefund ? GAME.radarActivationCost : 0) + legacyTankRefund,
      radarCharges: THREE.MathUtils.clamp(Math.floor(save.radarCharges ?? 3), 0, 5),
      radarActive: false, stormCount: Math.max(0, Math.floor(save.stormCount ?? 0)),
      nextStormAt: Math.max(save.runTime, save.nextStormAt ?? save.runTime + GAME.stormIntervalMin),
      nextSevereStorm: Math.max(5, Math.floor(save.nextSevereStorm ?? 6)),
      stormPhase: save.stormPhase ?? "calm", stormTimer: Math.max(0, save.stormTimer ?? 0), severeStorm: save.severeStorm ?? false,
      upgrades: levels, tools, rails, railNetwork: Array.isArray(save.railNetwork?.nodes) && Array.isArray(save.railNetwork?.edges) ? save.railNetwork : undefined,
    };
  }
  private saveGame(): void {
    if (!this.state.is("playing") && !this.state.is("paused") && !this.state.is("gameover")) return;
    const data: SaveData = {
      version: 11, runTime: this.runTime, raw: this.raw, purified: this.purified, ice: this.ice, credits: this.credits, heat: this.heat, power: this.power, rawSold: this.rawSold, cleanupCertified: this.cleanupCertified, radarCharges: this.radarCharges,
      scannerCooldown: this.scannerCooldown, status: this.state.is("gameover") ? "gameover" : this.state.is("paused") ? "paused" : "playing",
      radarActive: false, stormCount: this.stormCount, nextStormAt: this.nextStormAt, nextSevereStorm: this.nextSevereStorm,
      stormPhase: this.stormPhase, stormTimer: this.stormTimer, severeStorm: this.severeStorm,
      recovered: this.recovered, produced: this.produced, collectedRaw: this.collectedRaw, purifiedSold: this.purifiedSold,
      saleCreditRemainder: this.saleRemainder, retainedCargo: this.buildings.retainedCargo(),
      sold: this.sold, iceSold: this.iceSold, railDelivered: this.railDelivered, questIndex: this.questIndex,
      upgrades: { ...this.upgrades }, tools: { ...this.tools }, toolHealth: { ...this.toolHealth }, selectedTool: this.selectedTool, salesHistory: this.salesHistory.filter((sale) => sale.time > this.runTime - 60),
      player: { x: this.player.group.position.x, z: this.player.group.position.z }, snow: this.snow.serialize(),
      cores: this.world.cores.map((c) => ({ id: c.id, scanned: c.scanned, revealed: c.revealed, recovered: c.recovered })),
      buildings: this.buildings.serialize(), rails: this.rails.serialize(), railNetwork: this.rails.network.serialize(),
      relays: this.relays.serialize(), events: this.events.map((event) => ({ ...event })),
    };
    this.hasSave = storage.set(GAME.saveKey, data);
  }
  private restore(save: SaveData): void {
    this.resetRun(); this.runTime = save.runTime; this.raw = save.raw; this.purified = save.purified; this.ice = save.ice; this.credits = save.credits;
    this.heat = save.heat; this.heatWarningArmed = this.heat >= 28; this.power = save.power; this.recovered = save.recovered; this.produced = save.produced; this.sold = save.sold;
    this.iceSold = save.iceSold; this.rawSold = save.rawSold; this.cleanupCertified = save.cleanupCertified; this.railDelivered = save.railDelivered; this.questIndex = Math.min(9, save.questIndex);
    this.collectedRaw = save.collectedRaw ?? 0; this.purifiedSold = save.purifiedSold ?? 0; this.radarCharges = save.radarCharges;
    this.radarActive = false; this.scannerCooldown = save.scannerCooldown;
    this.events = save.events.map((event) => ({ ...event })); this.nextEventId = Math.max(0, ...this.events.map((event) => event.id)) + 1;
    this.stormCount = save.stormCount; this.nextStormAt = save.nextStormAt; this.nextSevereStorm = save.nextSevereStorm;
    this.stormPhase = save.stormPhase; this.stormTimer = save.stormTimer; this.severeStorm = save.severeStorm;
    this.stormIntensity = this.stormPhase === "storm" ? this.severeStorm ? 1.22 : 1 : this.stormPhase === "warning" ? 0.16 : 0;
    this.upgrades = { ...blankUpgrades(), ...save.upgrades }; this.tools = { ...blankTools(), ...save.tools }; this.toolHealth = { ...fullToolHealth(), ...save.toolHealth }; this.salesHistory = save.salesHistory.map((sale) => ({ ...sale })); this.selectedTool = save.selectedTool;
    this.player.group.position.set(save.player.x, this.snow.heightAt(save.player.x, save.player.z), save.player.z); this.physics.reset(save.player.x, save.player.z);
    this.snow.restore(save.snow); this.buildings.restore(save.buildings); this.buildings.restoreRetained(save.retainedCargo); this.rails.restore(save.rails); this.rails.network.restore(save.railNetwork as NetSave | undefined); this.relays.restore(save.relays);
    this.saleRemainder = Math.max(0, Number(save.saleCreditRemainder) || 0);
    this.buildings.setRelaySites(this.relays.items.map((relay) => ({ id: relay.id, x: relay.x, z: relay.z, repaired: relay.repaired })));
    this.buildings.refreshPowerGrid();
    this.buildings.setAuxiliaryZones(this.relays.items.filter((relay) => this.buildings.relayPowered(relay.id)).map((relay) => ({ x: relay.x, z: relay.z, r: relay.warmth })));
    this.buildings.setRelayBoosts(this.buildings.relayPowered("servo") ? 1.3 : 1, this.buildings.relayPowered("foundry") ? 1.3 : 1);
    for (const building of this.buildings.items) this.clearBuildingPad(building.x, building.z, BUILDINGS[building.type].radius);
    if (!this.tools[this.selectedTool]) this.selectedTool = "hands";
    for (const view of save.cores) { const core = this.world.cores.find((c) => c.id === view.id); if (core) { core.scanned = view.scanned; core.revealed = view.revealed; core.recovered = view.recovered; core.body.visible = view.revealed && !view.recovered; } }
    this.hasSave = true; this.updateToolVisual(); this.world.updateCores(this.snow);
    if (this.migrationRadarRefund) { this.migrationRadarRefund = false; this.recordEvent(this.t("toast.radarRefund"), "warm", "event"); }
  }

  private installDebug(): void {
    window.__whiteoutDebug = {
      snapshot: () => this.snapshot(), start: () => this.startRun(false), continue: () => this.continueRun(), pause: () => this.pause(), resume: () => this.resume(), save: () => this.saveGame(),
      teleport: (x: number, z: number) => { this.player.group.position.set(x, this.snow.heightAt(x, z), z); this.physics.reset(x, z); },
      giveCredits: (n: number) => { this.credits += n; this.updateUI(); }, setRaw: (n: number) => { this.raw = n; this.collectedRaw = Math.max(this.collectedRaw, n); this.updateQuest(); this.updateUI(); },
      setCarried: (pure: number, ice: number) => { this.purified = pure; this.ice = ice; this.updateUI(); }, setPower: (n: number) => { this.power = n; this.updateQuest(); this.updateUI(); },
      setQuest: (n: number) => { this.questIndex = THREE.MathUtils.clamp(Math.floor(n), 0, 9); this.updateUI(); },
      setRailDelivered: (n: number) => { this.railDelivered = Math.max(0, n); this.updateUI(); },
      scan: () => this.scan(), interact: () => this.interact(), buyTool: (id: ToolId) => this.buyTool(id), buyUpgrade: (id: UpgradeId) => this.buyUpgrade(id), buyBattery: () => this.buyBattery(), selectTool: (id: ToolId) => this.selectTool(id), repairTool: (id: ToolId) => this.repairTool(id), openUpgrades: () => this.openUpgrades(),
      build: (type: BuildingType, x: number, z: number) => { const b = this.buildings.build(type, x, z, () => true); if (b) this.clearBuildingPad(x, z, BUILDINGS[type].radius); this.updateQuest(); this.updateUI(); return b?.id; },
      buyBuilding: (type: BuildingType, x: number, z: number) => {
        if (type === "generator" && !this.buildings.generatorReaches(x, z)) return undefined;
        if (!this.confirmPowerPlacement(type, x, z)) return undefined;
        const b = this.buildings.build(type, x, z, (cost) => this.charge(cost)); if (b) this.clearBuildingPad(x, z, BUILDINGS[type].radius); this.updateQuest(); this.updateUI(); return b?.id;
      },
      selectBuild: (type: BuildingType) => this.selectBuild(type), ghostCount: () => this.ghost.children.reduce((sum, group) => { let count = 0; group.traverse((o) => { if (o instanceof THREE.Mesh) count++; }); return sum + count; }, 0),
      visualState: () => ({ tools: Object.fromEntries(Object.entries(this.player.tools).map(([id, group]) => [id, group.visible])), footprints: this.effects.footprintTotalCount, activeFootprints: this.effects.activeFootprintCount, stormStreaks: this.effects.stormVisible, stormIntensity: this.stormIntensity, character: this.character.state(), facingX: this.facing.x, facingZ: this.facing.z, yaw: this.player.group.rotation.y }),
      buildingVisuals: () => this.buildings.visualDetails(),
      rail: (sourceId: number, destinationId?: number) => {
        const b = this.buildings.byId(sourceId); if (!b) return false;
        const kind = this.buildings.cargoKind(b); const dest = destinationId ?? (kind === "raw" ? this.buildings.items.find((it) => it.type === "purifier")?.id ?? 0 : 0);
        const target = this.buildings.byId(dest); const dx = dest === 0 ? GAME.depot.x : target?.x ?? GAME.depot.x; const dz = dest === 0 ? GAME.depot.z - 1.7 : target?.z ?? GAME.depot.z - 1.7;
        const r = this.rails.create(sourceId, dest, RailSystem.pathFor(b.x, b.z, dx, dz), () => true); this.updateUI(); return !!r;
      },
      buyRail: (sourceId: number, destinationId?: number) => {
        const b = this.buildings.byId(sourceId); if (!b) return false;
        const kind = this.buildings.cargoKind(b); const dest = destinationId ?? (kind === "raw" ? this.buildings.items.find((it) => it.type === "purifier")?.id ?? 0 : 0);
        const target = this.buildings.byId(dest); const dx = dest === 0 ? GAME.depot.x : target?.x ?? GAME.depot.x; const dz = dest === 0 ? GAME.depot.z - 1.7 : target?.z ?? GAME.depot.z - 1.7;
        const r = this.rails.create(sourceId, dest, RailSystem.pathFor(b.x, b.z, dx, dz), (cost) => this.charge(cost)); this.updateUI(); return !!r;
      },
      editRail: (sourceId: number, destinationId: number, points: RailPathPoint[]) => {
        const source = this.buildings.byId(sourceId); const end = this.railEndpoint(destinationId);
        if (!source || !end) return { ok: false, reason: "missing", extra: 0, total: 0 };
        const existing = this.rails.find(sourceId, destinationId);
        this.buildMode = "rail"; this.input.mode = "build"; this.input.cameraRotate = true;
        this.openRailDraft(sourceId, destinationId, [{ x: source.x, z: source.z }, ...points, end], existing?.lane ?? this.rails.nextLane(), existing?.paid ?? 0, !!existing);
        return this.confirmRailDraft();
      },
      selectRail: () => this.selectRail(),
      worldToScreen: (x: number, z: number) => {
        const projected = new THREE.Vector3(x, groundHeight(x, z) + 1.2, z).project(this.camera);
        const rect = this.renderer.domElement.getBoundingClientRect();
        return { x: (projected.x * 0.5 + 0.5) * rect.width + rect.left, y: (-projected.y * 0.5 + 0.5) * rect.height + rect.top, behind: projected.z > 1 };
      },
      setOutput: (id: number, n: number) => { const b = this.buildings.byId(id); if (b) b.output = n; }, setInput: (id: number, n: number) => { const b = this.buildings.byId(id); if (b) b.input = n; },
      upgradeNearest: () => this.upgradeNearest(),
      moveBuilding: (id: number, x: number, z: number) => { const moved = this.buildings.relocate(id, x, z); if (moved) this.rails.removeBuilding(id); if (moved) { const b = this.buildings.byId(id); if (b) this.clearBuildingPad(x, z, BUILDINGS[b.type].radius); } this.updateUI(); return moved; },
      demolishBuilding: (id: number) => this.demolishById(id),
      clearAt: (x: number, z: number, r = 4) => this.snow.clear(x, z, r, 4),
      revealAll: () => { for (const c of this.world.cores) { c.scanned = true; this.snow.clear(c.x, c.z, 2, 4); } this.world.updateCores(this.snow); },
      recoverAll: () => { for (const c of this.world.cores) if (!c.recovered) { c.scanned = true; c.revealed = true; this.recoverCore(c, false); } this.recovered = 3; this.power = 100; this.questIndex = 9; this.updateQuest(); },
      robotStates: () => this.buildings.items.flatMap((b) => b.robots.map((r) => ({
        id: b.id, buildingId: b.id, slot: r.slot, kind: r.kind,
        x: r.group.position.x, z: r.group.position.z, frozen: r.frozen, temperature: r.temperature, thaw: r.thaw,
        health: r.health, carry: r.carry, mode: r.mode, energy: r.energy,
        zoneAuto: r.zoneAuto, zoneX: r.zoneX, zoneZ: r.zoneZ, zoneRange: r.zoneRange, zoneMode: r.zoneMode,
        activeChunk: r.activeChunk, chunkIds: [...r.chunkIds], chunkProgress: r.chunkProgress, searchRange: r.searchRange,
        lane: r.planLane, sweep: r.planCursor,
        pathLength: r.path.length, pathIndex: r.pathIndex, yaw: r.group.rotation.y, repairAllowed: r.repairAllowed, paymentWait: r.paymentWait, rescueProgress: r.rescue,
        sourceId: r.sourceId, destinationId: r.destinationId,
        targetX: r.target?.x ?? null, targetZ: r.target?.z ?? null,
      }))),
      freezeRobots: () => { let i = 0; for (const b of this.buildings.items) if (b.type === "sweeper") for (const r of b.robots) { r.group.position.set(30 + i++ * 2, groundHeight(30, 30), 30); r.temperature = 0; r.frozen = true; r.frost.visible = true; } },
      buyExtraRobot: (buildingId: number) => this.buyExtraRobot(buildingId),
      setRobotZone: (buildingId: number, slot: number, auto: boolean, x?: number, z?: number, range?: number) => this.setRobotZone(buildingId, slot, auto, range ?? 16, x, z),
      setRobotZoneMode: (buildingId: number, slot: number, mode: RobotZoneMode, chunkId?: number) => this.setRobotZoneMode(buildingId, slot, mode, chunkId),
      assignWorkArea: (buildingId: number, x: number, z: number) => this.buildings.assignWorkArea(buildingId, x, z),
      clearWorkArea: (buildingId: number) => this.buildings.clearWorkArea(buildingId),
      repairRelay: (id: RelayId) => this.repairRelay(id), openLog: () => this.openLog(), openRobots: () => this.openRobots(),
      heaterSites: () => this.world.heaterSites.map((site) => ({ ...site })),
      obstacles: () => this.world.obstacles.map((obstacle) => ({ ...obstacle })),
      vista: () => this.world.vista.map((mountain) => ({ ...mountain })),
      frameStats: () => ({ calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, fps: this.measuredFps }),
      cameraPose: () => ({ x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z }),
      setAzimuth: (azimuth: number) => { this.cameraAzimuth = azimuth; },
      storm: (severe = false) => { this.forceNextSevere = severe; if (severe) this.nextSevereStorm = this.stormCount + 1; this.nextStormAt = this.runTime; this.stormPhase = "warning"; },
      repairBuilding: (id: number) => { const building = this.buildings.byId(id); const repaired = building?.damaged ? this.buildings.repair(id, (cost) => this.charge(cost)) : this.buildings.serviceRobots(id, (cost) => this.charge(cost)); if (repaired) this.audio.sfx("repair"); this.updateUI(); return repaired; },
      damageBuilding: (id: number) => { const damaged = this.buildings.damage(id); this.updateUI(); return damaged; },
      setRobotHealth: (id: number, health: number) => { const b = this.buildings.byId(id); if (!b?.robot) return; b.robot.health = THREE.MathUtils.clamp(health, 0, 100); if (b.robot.health <= 0) { b.robot.mode = "damaged"; b.robot.moving = false; b.robot.working = false; } this.updateUI(); },
      setRobotEnergy: (id: number, energy: number) => { const b = this.buildings.byId(id); if (!b?.robot || b.robot.kind !== "hauler") return; b.robot.energy = THREE.MathUtils.clamp(energy, 0, 100); this.updateUI(); },
      setRobotTemperature: (id: number, slot: number, temperature: number, frozen = false) => { const robot = this.buildings.byId(id)?.robots.find((unit) => unit.slot === slot); if (!robot) return false; robot.temperature = THREE.MathUtils.clamp(temperature, 0, 100); robot.frozen = frozen; robot.frost.visible = frozen; if (!frozen) robot.thaw = 0; return true; },
      setToolHealth: (id: ToolId, health: number) => { this.toolHealth[id] = THREE.MathUtils.clamp(health, 0, 100); this.updateUI(); },
      audioState: () => this.audio.state(), baseVisual: () => this.world.baseVisual(),
      toolStats: (id: ToolId, level: number) => toolTierStats(id, level),
      holdClear: (held: boolean) => { this.debugClear = held; },
      snowMass: () => this.snow.totalRemaining,
      paintSnow: (x: number, z: number, radius: number, density: number) => this.snow.paintDisk(x, z, radius, density),
      snowDisk: (x: number, z: number, radius: number) => this.snow.diskMass(x, z, radius),
      walk: (x: number, z: number) => { this.input.moveX = x; this.input.moveZ = z; },
      aimPoint: () => ({ x: this.brushPoint.x, z: this.brushPoint.z, radius: this.clearRadius, px: this.player.group.position.x, pz: this.player.group.position.z }),
      aimMarkers: () => this.effects.aimMarkers(),
      grounding: () => ({ playerY: this.player.group.position.y, physicsFootY: this.physics.footY, snowHeight: this.snow.heightAt(this.player.group.position.x, this.player.group.position.z), groundHeight: groundHeight(this.player.group.position.x, this.player.group.position.z), soleY: this.player.group.position.y + this.player.body.position.y - 0.23 }),
      freezeRobot: (id: number, slot = 0) => { const r = this.buildings.byId(id)?.robots.find((robot) => robot.slot === slot); if (!r) return false; r.group.position.set(30 + slot * 2, groundHeight(30 + slot * 2, 30), 30); r.temperature = 0; r.frozen = true; r.rescue = 0; r.thaw = 0; r.frost.visible = true; this.updateUI(); return true; },
      placeRobot: (id: number, slot: number, x: number, z: number) => {
        const robot = this.buildings.byId(id)?.robots.find((unit) => unit.slot === slot);
        if (!robot) return false;
        robot.group.position.set(x, groundHeight(x, z) + (robot.kind === "hauler" ? 0.18 : 0.06), z);
        robot.path = []; robot.pathIndex = 0; robot.target = null; robot.stuck = 0; robot.pathGoal = { x: Number.NaN, z: Number.NaN };
        robot.returning = false; robot.mode = robot.frozen ? "wait" : robot.kind === "hauler" ? "patrol" : "seek";
        return true;
      },
      freezeLog: () => this.buildings.freezeEvents.map((event) => ({ ...event })),
      setRepairAllowed: (id: number, slot: number, allowed: boolean) => this.buildings.setRepairAllowed(id, slot, allowed),
      rescueAt: (x: number, z: number) => this.buildings.startRescue(x, z),
      setRobotCarry: (id: number, slot: number, carry: number) => { const robot = this.buildings.byId(id)?.robots.find((unit) => unit.slot === slot); if (!robot) return false; robot.carry = Math.max(0, carry); robot.returning = robot.kind === "sweeper" && robot.carry > 0.01; if (robot.returning) robot.mode = "return"; return true; },
      logistics: () => ({
        retained: this.buildings.retainedCargo(), saleRemainder: this.saleRemainder,
        buildings: this.buildings.items.map((b) => ({ id: b.id, type: b.type, output: b.output, input: b.input, outputCapacity: this.buildings.outputCapacity(b), inputCapacity: this.buildings.capacity(b), damaged: b.damaged })),
      }),
      qualityDecision: (state, sample) => advanceQualityLatch(state, sample),
      applyFpsSample: (fps: number, hidden = false) => { this.considerQuality(fps, hidden); return { lowQuality: this.lowQuality, lowStreak: this.fpsLowStreak, highStreak: this.fpsHighStreak, hold: this.qualityHold }; },
      cameraState: () => ({ railMode: this.buildMode === "rail", rotationEnabled: this.input.cameraRotate, azimuth: this.cameraAzimuth, distance: Math.hypot(this.desiredCamera.x - this.player.group.position.x, this.desiredCamera.z - this.player.group.position.z) }),
      powerState: () => this.buildings.powerSnapshot(),
      powerPreview: (type: BuildingType, x: number, z: number, ignoreId?: number) => this.buildings.forecastPower(type, x, z, ignoreId),
      win: () => { this.questIndex = 9; this.power = 100; this.recovered = 3; this.snow.restore(Array(160 * 160).fill(0)); this.updateQuest(); }, lose: () => this.gameOver(),
      step: (seconds: number) => { for (let i = 0, count = Math.min(18000, Math.ceil(seconds * 60)); i < count; i++) this.update(1 / 60); this.updateUI(); },
      snowAt: (x: number, z: number) => this.snow.sample(x, z), groundAt: (x: number, z: number) => groundHeight(x, z),
      railState: () => this.rails.items.map((r) => { let corners = 0, modernRails = 0, oneWayArrows = 0; r.group.traverse((o) => { if (o.userData.corner) corners++; if (o.userData.modernRail) modernRails++; if (o.userData.oneWay) oneWayArrows++; }); const mid = r.travel[Math.floor(r.travel.length / 2)] ?? r.path[0]; return { sourceId: r.sourceId, destinationId: r.destinationId, kind: r.kind, total: r.total, corners, modernRails, oneWayArrows, lane: r.lane, routed: r.routed, paid: r.paid, path: r.path.map((point) => ({ ...point })), midpoint: { x: mid.x, z: mid.z }, activeCapsules: r.capsules.filter((c) => c.active).length, cargo: r.capsules.reduce((sum, c) => sum + c.cargo, 0), capsules: r.capsules.map((c) => ({ active: c.active, cargo: c.cargo, distance: c.distance, waiting: c.wait > 0, visible: c.group.visible })) }; }),
      netPlace: (kind, x, z) => this.rails.network.place(kind, x, z),
      netLink: (from, to) => this.rails.network.link(from, to, (cost) => this.charge(cost)),
      previewStroke: (points: RailPathPoint[]) => this.rails.network.previewStroke(points),
      commitStroke: (points: RailPathPoint[]) => { const result = this.rails.network.commitStroke(points, (cost) => this.charge(cost)); if (result.ok) this.saveGame(); this.updateUI(); return result; },
      deleteEdge: (edgeId: number) => { const result = this.rails.network.removeEdge(edgeId); if (result.ok) this.saveGame(); this.updateUI(); return result; },
      reshapeEdge: (edgeId: number, points: RailPathPoint[]) => { const result = this.rails.network.reshape(edgeId, points, (cost) => this.charge(cost)); if (result.ok) this.saveGame(); this.updateUI(); return result; },
      buildingSpan: (type: BuildingType) => {
        const building = this.buildings.items.find((item) => item.type === type); if (!building) return null;
        const box = new THREE.Box3();
        building.group.traverse((object) => { if (object instanceof THREE.Mesh && !(object.geometry instanceof THREE.RingGeometry)) box.expandByObject(object); });
        const size = box.getSize(new THREE.Vector3());
        return { x: size.x, y: size.y, z: size.z };
      },
      netPolicy: (id, policy, ratio, priority) => this.rails.network.policy(id, policy, ratio, priority),
      netState: () => this.rails.network.state(),
      netVisual: () => this.rails.network.visual(),
      netReshape: (edgeId, points) => this.rails.network.reshape(edgeId, points, (cost) => this.charge(cost)),
      stats: () => ({ fps: this.measuredFps, calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, lowQuality: this.lowQuality, renderer: this.gpuName }),
    };
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.loop.stop(); window.removeEventListener("resize", this.onResize); document.removeEventListener("visibilitychange", this.onVisibility);
    this.input.dispose(); this.cameraControls.dispose(); this.character.dispose(); this.audio.dispose(); this.cinematic.dispose(); this.tutorial.dispose(); this.ui.dispose(); this.rails.dispose(); this.buildings.dispose(); this.snow.dispose(this.scene); this.effects.dispose(); this.world.dispose(); this.physics.dispose(); this.models.dispose(); this.renderer.dispose();
    delete window.__gameProbe; delete window.__whiteoutDebug; window.__GAME_READY__ = false;
  }
}

let launchCreditGrant: number | null | undefined;
function readLaunchCreditGrant(): number | null {
  if (launchCreditGrant !== undefined) return launchCreditGrant;
  const raw = new URLSearchParams(location.search).get("credits");
  const amount = raw == null || raw.trim() === "" ? Number.NaN : Math.floor(Number(raw));
  launchCreditGrant = Number.isFinite(amount) && amount >= 0 ? amount : null;
  if (launchCreditGrant != null) {
    const params = new URLSearchParams(location.search);
    params.delete("credits");
    const query = params.toString();
    history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  }
  return launchCreditGrant;
}

export function startGame(canvas: HTMLCanvasElement, overlay?: HTMLElement): void {
  stopGame(); const root = overlay ?? document.getElementById("ui-overlay"); if (!root) throw new Error("Missing UI overlay");
  const game = new WhiteoutGame(canvas, root); session = { dispose: () => game.dispose() };
}
export function stopGame(): void { session?.dispose(); session = null; }
