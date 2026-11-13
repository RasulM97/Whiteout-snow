import { BUILDINGS, TOOLS, TOOL_UPGRADES, UPGRADES, toolRepairCost, type BuildingType, type GameSnapshot, type GameState, type Language, type PausePanel, type RobotZoneMode, type SettingsView, type ToolId, type UpgradeId } from "./types";
import { locale, translate } from "./i18n";
import { toolTierStats } from "./tool-progression";

export interface UIHandlers {
  start: () => void; continue: () => void; resume: () => void; restart: () => void; checkpoint: () => void; pause: () => void;
  openUpgrades: () => void; openSettings: () => void; openRobots: () => void; openLog: () => void; closePanel: () => void; mute: () => void; tutorial: () => void;
  scan: () => void; interact: () => void; buyUpgrade: (id: UpgradeId) => void; buyBattery: () => void;
  buyTool: (id: ToolId) => void; selectTool: (id: ToolId) => void; repairTool: (id: ToolId) => void;
  selectBuild: (type: BuildingType) => void; selectRail: () => void; upgradeBuilding: () => void;
  moveBuilding: () => void; demolishBuilding: () => void; repairBuilding: () => void;
  buyExtraRobot: (buildingId: number) => void; robotZoneMode: (buildingId: number, slot: number, mode: RobotZoneMode, chunkId?: number) => void;
  robotRepairAllowed: (buildingId: number, slot: number, allowed: boolean) => void;
  setting: <K extends keyof SettingsView>(key: K, value: SettingsView[K]) => void;
}
const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const buildingOrder: BuildingType[] = ["purifier", "press", "heater", "sweeper", "hauler", "generator"];
const icons: Record<BuildingType | "rail", string> = { purifier: "◇", press: "▤", heater: "♨", sweeper: "●", hauler: "▣", generator: "ϟ", rail: "╫" };
function shopArt(id: ToolId | UpgradeId | "battery"): string {
  const drawings: Record<string, string> = {
    hands: '<path d="M30 62V39l9-12 8 5-4 12 10-6 7 8-12 22H38z" fill="#ff985f"/><path d="M90 62V39l-9-12-8 5 4 12-10-6-7 8 12 22h10z" fill="#e8e4d5"/><circle cx="60" cy="40" r="12" fill="#e9f7f5"/><circle cx="48" cy="54" r="9" fill="#bfe6e5"/>',
    shovel: '<path d="M39 22l7 2-15 46-7-2z" fill="#ff985f"/><path d="M29 18h20v8H29z" rx="4" fill="#e8e4d5"/><path d="M22 62h22l8 25H17z" fill="#bfe6e5"/><path d="M20 70h28" stroke="#315b68" stroke-width="3"/>',
    brush: '<path d="M26 29h68v12H26z" fill="#ff985f"/><rect x="17" y="48" width="86" height="25" rx="12" fill="#315b68"/><path d="M22 50v21m12-23v27m13-27v27m13-27v27m13-27v27m13-27v27m12-25v21" stroke="#79f0df" stroke-width="5"/><path d="M35 24l8-12h34l8 12" fill="none" stroke="#e8e4d5" stroke-width="6"/>',
    blower: '<rect x="18" y="25" width="43" height="43" rx="12" fill="#ff985f"/><rect x="26" y="34" width="27" height="12" rx="3" fill="#79f0df"/><path d="M57 44h45l8 14H57z" fill="#315b68"/><ellipse cx="105" cy="51" rx="8" ry="15" fill="#79f0df"/><path d="M35 68v14m15-14v14" stroke="#e8e4d5" stroke-width="6"/>',
    vacuum: '<rect x="19" y="22" width="42" height="52" rx="10" fill="#e8e4d5"/><rect x="26" y="31" width="28" height="14" rx="3" fill="#79f0df"/><circle cx="29" cy="77" r="9" fill="#19333d"/><circle cx="53" cy="77" r="9" fill="#19333d"/><path d="M58 54c35-23 22 18 43 4" fill="none" stroke="#ff985f" stroke-width="8"/><path d="M91 49h22l-5 24H88z" fill="#315b68"/>',
    scanner: '<path d="M31 75h58M60 75V49" stroke="#e8e4d5" stroke-width="6"/><path d="M32 22c3 34 48 34 56 0-18 12-38 12-56 0z" fill="#79f0df"/><path d="M60 40V19" stroke="#ff985f" stroke-width="5"/><path d="M76 13c10 5 14 12 15 21M82 4c16 7 24 18 25 32" fill="none" stroke="#79f0df" stroke-width="3" stroke-linecap="round"/>',
    thermal: '<path d="M40 23h40l12 20-9 38H37l-9-38z" fill="#ff985f"/><path d="M49 23c0 13 22 13 22 0M60 15v64" fill="none" stroke="#e8e4d5" stroke-width="5"/><path d="M61 37c13 14 4 18 9 27-2 9-18 10-21 0-3-9 8-13 12-27z" fill="#ffd58d"/>',
    boots: '<path d="M27 15h24v37l17 10v17H20V51h7z" fill="#315b68"/><path d="M20 67h48v12H20z" fill="#e8e4d5"/><path d="M76 26h18v28l13 8v15H70V55h6z" fill="#ff985f"/><path d="M70 65h37v12H70z" fill="#e8e4d5"/>',
    battery: '<rect x="31" y="18" width="58" height="65" rx="10" fill="#e8e4d5"/><path d="M49 10h22v10H49z" fill="#ff985f"/><rect x="39" y="29" width="42" height="43" rx="5" fill="#315b68"/><path d="M64 31L45 55h14l-5 18 20-27H61z" fill="#79f0df"/>',
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 96"><rect width="120" height="96" rx="18" fill="#102f39"/><circle cx="92" cy="18" r="27" fill="#173f49"/>${drawings[id]}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function timeText(seconds: number): string { const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60); return `${m}:${s.toString().padStart(2, "0")}`; }

export class GameUI {
  private snapshot: GameSnapshot | null = null; private toastTimer = 0; private language: Language = "en";
  constructor(private root: HTMLElement, private handlers: UIHandlers) {
    root.innerHTML = `
      <section id="orientation-lock" class="orientation-lock" aria-live="polite"><div class="rotate-device" aria-hidden="true">▭<span>↻</span></div><h2 data-i18n="mobile.rotateTitle"></h2><p data-i18n="mobile.rotateCopy"></p><b data-i18n="mobile.landscape"></b></section>
      <div id="hud" class="hud hidden">
        <section class="quest-card glass">
          <div class="eyebrow" data-i18n="brand.operation"></div>
          <div class="quest-heading"><span id="quest-index"></span><b id="quest-title"></b></div>
          <p id="quest-desc"></p>
          <div class="quest-progress-row"><span id="quest-progress"></span><span id="quest-reward"></span></div>
          <div class="meter"><i id="quest-bar" class="quest-fill"></i></div>
          <div class="objective-line"><span class="objective-arrow">➤</span><span id="objective-text"></span></div>
          <div class="memory-row"><span data-i18n="hud.clues"></span><span id="core-pips" class="core-pips"></span></div>
        </section>
        <section class="resource-card glass">
          <div class="credit-line"><span data-i18n="hud.credits"></span><strong id="credits-text"></strong></div>
          <div class="sales-rate"><span data-i18n="hud.salesMinute"></span><b id="sales-rate">0</b></div>
          <div class="cleanup-live"><div><span data-i18n="hud.cleanup"></span><b id="cleanup-text">0.0%</b></div><div class="meter"><i id="cleanup-bar"></i></div></div>
          <div class="inventory-grid">
            <div><span class="resource-icon raw">●</span><small data-i18n="hud.raw"></small><b id="raw-text"></b></div>
            <div><span class="resource-icon pure">◆</span><small data-i18n="hud.purified"></small><b id="pure-text"></b></div>
            <div><span class="resource-icon ice">▣</span><small data-i18n="hud.ice"></small><b id="ice-text"></b></div>
          </div>
          <div class="resource-line"><span data-i18n="hud.load"></span><strong id="load-text"></strong></div><div class="meter"><i id="load-bar" class="load-fill"></i></div>
          <div id="tank-status" class="tank-status"></div>
          <div class="wayfinding"><span data-i18n="hud.saleWhere"></span><span data-i18n="hud.shopWhere"></span></div>
          <div class="resource-line"><span data-i18n="hud.heat"></span><strong id="heat-text"></strong></div><div class="meter"><i id="heat-bar" class="heat-fill"></i></div>
          <div class="resource-line power-label"><span data-i18n="hud.power"></span><strong id="power-text"></strong></div><div class="meter"><i id="power-bar" class="power-fill"></i></div><button id="power-help-btn" class="power-note" data-i18n="power.short"></button>
        </section>
        <div class="tool-chip glass"><span class="key">1–5</span><div><small data-i18n="hud.tool"></small><b id="tool-name"></b><div class="tool-health-line"><span data-i18n="hud.toolHealth"></span><strong id="tool-health-text"></strong></div><div class="meter"><i id="tool-health-bar"></i></div></div></div>
        <div id="scanner-chip" class="scanner-chip glass"><span class="key">Q</span><span id="signal-sector" class="signal-sector">↑</span><div><span id="scanner-text"></span><small id="signal-text"></small><div class="signal-meter"><i id="signal-bar"></i></div></div><button id="hud-battery-btn" class="battery-btn" data-i18n="shop.addBattery"></button><button id="relay-help-btn" class="battery-btn" data-i18n="relay.help"></button></div>
        <section id="relay-guide" class="radar-guide glass hidden"><div class="radar-guide-head"><b data-i18n="relay.guideTitle"></b><button id="close-relay-help" aria-label="Close">×</button></div><p data-i18n="relay.guideCopy"></p><div id="relay-list" class="relay-list"></div><div class="power-explainer"><b data-i18n="power.explainTitle"></b><p data-i18n="power.explain"></p><small data-i18n="power.explainRanges"></small></div></section>
        <div id="robot-alert" class="robot-alert glass hidden"><span>❄</span><b id="robot-alert-text"></b></div>
        <section id="building-card" class="building-card glass hidden">
          <div class="building-card-head"><b id="building-name"></b><span id="building-level"></span></div>
          <div class="building-status" id="building-status"></div>
          <p id="building-desc" class="building-desc"></p>
          <div id="building-production" class="building-production hidden"><span data-i18n="build.throughput"></span><b id="building-production-rate"></b><small id="building-next-rate"></small></div>
          <div class="building-buffers">
            <div id="building-robot-row" class="buffer-row hidden"><div class="buffer-label"><span data-i18n="build.robotTank"></span><b id="building-robot-tank"></b></div><div class="meter tank-meter"><i id="building-robot-bar"></i></div></div>
            <div id="building-health-row" class="buffer-row hidden"><div class="buffer-label"><span data-i18n="hud.robotHealth"></span><b id="building-robot-health"></b></div><div class="meter tank-meter"><i id="building-robot-health-bar"></i></div></div>
            <div id="building-input-row" class="buffer-row"><div class="buffer-label"><span data-i18n="build.input"></span><b id="building-input"></b></div><div class="meter tank-meter"><i id="building-input-bar"></i></div></div>
            <div id="building-output-row" class="buffer-row"><div class="buffer-label"><span data-i18n="build.dockTank"></span><b id="building-output"></b></div><div class="meter tank-meter"><i id="building-output-bar"></i></div></div>
            <div id="building-no-storage" class="building-no-storage hidden" data-i18n="build.noStorage"></div>
          </div>
          <div class="building-power-grid">
            <span data-i18n="build.powerSource"></span><b id="building-power-source"></b>
            <span data-i18n="build.powerLoad"></span><b id="building-power-load"></b>
            <span data-i18n="build.efficiency"></span><b id="building-efficiency"></b>
            <span id="building-cable-label" data-i18n="build.cable"></span><b id="building-cable"></b>
          </div>
          <div class="building-actions"><button id="repair-building-btn" class="small-action repair-action hidden"></button><button id="upgrade-building-btn" class="small-action"></button><button id="move-building-btn" class="small-action" data-i18n="action.moveBuilding"></button><button id="demolish-building-btn" class="small-action danger-action" data-i18n="action.demolish"></button></div>
        </section>
      </div>
      <div class="top-actions">
        <button id="mute-btn" class="icon-btn sound-btn" aria-label="Audio"><span id="mute-icon" aria-hidden="true">🔊</span><span data-i18n="action.sound"></span></button>
        <button id="shop-btn" class="icon-btn hidden" data-i18n="action.tools"></button>
        <button id="robots-btn" class="icon-btn hidden" data-i18n="action.robots"></button>
        <button id="log-btn" class="icon-btn hidden" data-i18n="action.log"></button>
        <button id="relay-top-btn" class="icon-btn hidden" data-i18n="relay.help"></button>
        <button id="settings-btn" class="icon-btn" data-i18n="action.settings"></button>
        <button id="pause-btn" class="icon-btn hidden" data-i18n="action.pause"></button>
      </div>
      <div id="storm-forecast" class="storm-forecast glass hidden"><div><span data-i18n="storm.forecast"></span><b id="storm-eta"></b></div><div class="meter"><i id="storm-forecast-bar"></i></div></div>
      <div id="event-banner" class="event-banner hidden"><span class="event-dot"></span><span id="event-text"></span></div>
      <div id="storm-vignette" class="storm-vignette"></div>
      <div id="reward-layer" class="reward-layer"></div>
      <div id="toast" class="toast"></div>
      <div id="prompt" class="prompt hidden"><span class="key">E</span><span id="prompt-text"></span></div>
      <div id="build-hint" class="build-hint hidden"></div>
      <nav id="build-dock" class="build-dock glass hidden" aria-label="Construction">
        ${buildingOrder.map((id) => `<button class="build-btn" data-build="${id}"><span class="build-icon">${icons[id]}</span><span class="build-copy"><b data-building-name="${id}"></b><small data-building-cost="${id}"></small></span></button>`).join("")}
        <button class="build-btn rail-btn" data-build="rail"><span class="build-icon">${icons.rail}</span><span class="build-copy"><b data-i18n="action.rail"></b><small>2.2 / m</small></span></button>
      </nav>
      <div id="desktop-help" class="desktop-help hidden"><span><b>WASD</b> <i data-i18n="controls.move"></i></span><span><b>Shift</b> <i data-i18n="controls.sprint"></i></span><span><b>Space</b> <i data-i18n="controls.clear"></i></span><span><b>Q</b> <i data-i18n="controls.scan"></i></span><span><b>E</b> <i data-i18n="controls.interact"></i></span><span><b>U</b> <i data-i18n="controls.upgrade"></i></span><span><b>Ctrl</b> <i data-i18n="controls.details"></i></span></div>
      <div id="touch-controls" class="touch-controls hidden">
        <div id="move-stick" class="move-stick" aria-label="Move"><div class="stick-arrows">+</div><div id="move-knob" class="move-knob"></div></div>
        <div class="touch-actions"><button id="touch-scan" class="touch-small" data-i18n="controls.scan"></button><button id="touch-interact" class="touch-small" data-i18n="controls.interact"></button><button id="touch-clear" class="touch-clear" data-i18n="controls.clear"></button></div>
      </div>
      <section id="title-screen" class="screen title-screen">
        <div class="title-content"><div class="title-kicker"><span class="title-signal"></span><span data-i18n="brand.recovery"></span></div><h1>WHITEOUT<br><span>STATION</span></h1><div class="persian-title" data-i18n="game.title"></div><p class="title-copy" data-i18n="game.tagline"></p>
          <div class="title-mission"><span data-i18n="title.mission"></span><b data-i18n="title.mapStats"></b></div>
          <div class="title-buttons"><button id="continue-btn" class="primary-btn hidden" data-i18n="action.continue"></button><button id="start-btn" class="secondary-btn" data-i18n="action.new"></button><button id="title-settings-btn" class="title-settings-btn" data-i18n="action.settings"></button></div>
          <div class="feature-row"><span data-i18n="title.feature1"></span><span data-i18n="title.feature2"></span><span data-i18n="title.feature3"></span></div><div class="save-note" data-i18n="title.localSave"></div>
        </div><div class="title-sticker glass"><b>10</b><span data-i18n="title.sticker"></span></div>
      </section>
      <section id="pause-screen" class="screen modal-screen hidden"><div class="modal glass"><div class="eyebrow" data-i18n="pause.eyebrow"></div><h2 data-i18n="pause.title"></h2><p data-i18n="pause.copy"></p><button id="resume-btn" class="primary-btn" data-i18n="action.resume"></button><button id="pause-log-btn" class="secondary-btn" data-i18n="action.log"></button><button id="pause-settings-btn" class="secondary-btn" data-i18n="action.settings"></button><button id="tutorial-pause-btn" class="secondary-btn" data-i18n="action.tutorial"></button><button id="restart-pause-btn" class="secondary-btn" data-i18n="action.restart"></button></div></section>
      <section id="upgrade-screen" class="screen modal-screen hidden"><div class="upgrade-modal glass"><div class="upgrade-head"><div><div class="eyebrow" data-i18n="shop.eyebrow"></div><h2 data-i18n="action.shop"></h2></div><div class="upgrade-wallet"><span data-i18n="shop.credits"></span><strong id="upgrade-credits"></strong></div></div><div id="tool-grid" class="upgrade-grid"></div><div class="shop-divider"></div><div id="gear-grid" class="upgrade-grid gear-grid"></div><button id="close-upgrades-btn" class="secondary-btn" data-i18n="action.back"></button></div></section>
      <section id="settings-screen" class="screen modal-screen hidden"><div class="modal settings-modal glass"><div class="eyebrow" data-i18n="settings.eyebrow"></div><h2 data-i18n="settings.title"></h2>
        <label><span data-i18n="settings.language"></span><select id="set-language"><option value="fa">فارسی</option><option value="en">English</option><option value="zh">中文</option></select></label>
        <label><span data-i18n="settings.quality"></span><select id="set-quality"><option value="auto" data-i18n="settings.auto"></option><option value="high" data-i18n="settings.high"></option><option value="low" data-i18n="settings.low"></option></select></label>
        <div class="settings-section" data-i18n="settings.audio"></div>
        <label><span data-i18n="settings.volume"></span><input id="set-volume" type="range" min="0" max="1" step="0.05"></label>
        <label><span data-i18n="settings.music"></span><input id="set-music-enabled" type="checkbox"></label>
        <label><span data-i18n="settings.track"></span><select id="set-music-track"><option value="quiet-aurora" data-i18n="music.quiet"></option><option value="snowglass-drift" data-i18n="music.glass"></option><option value="polar-night" data-i18n="music.night"></option><option value="none" data-i18n="music.none"></option></select></label>
        <label><span data-i18n="settings.musicVolume"></span><input id="set-music-volume" type="range" min="0" max="1" step="0.05"></label>
        <label><span data-i18n="settings.sfx"></span><input id="set-sfx-enabled" type="checkbox"></label>
        <label><span data-i18n="settings.sfxVolume"></span><input id="set-sfx-volume" type="range" min="0" max="1" step="0.05"></label>
        <label><span data-i18n="settings.ambience"></span><input id="set-ambience-enabled" type="checkbox"></label>
        <label><span data-i18n="settings.ambienceVolume"></span><input id="set-ambience-volume" type="range" min="0" max="1" step="0.05"></label>
        <div class="settings-section" data-i18n="settings.display"></div>
        <label><span data-i18n="settings.shake"></span><input id="set-shake" type="checkbox"></label><label><span data-i18n="settings.particles"></span><input id="set-particles" type="checkbox"></label>
        <label><span data-i18n="settings.uiScale"></span><select id="set-scale"><option value="0.9">90%</option><option value="1">100%</option><option value="1.1">110%</option></select></label>
        <button id="close-settings-btn" class="primary-btn" data-i18n="action.back"></button></div></section>
      <section id="robots-screen" class="screen modal-screen hidden"><div class="upgrade-modal robot-modal glass"><div class="upgrade-head"><div><div class="eyebrow" data-i18n="robot.eyebrow"></div><h2 data-i18n="robot.title"></h2></div><div class="upgrade-wallet"><span data-i18n="hud.robots"></span><strong id="robot-total"></strong></div></div><div id="robot-list" class="robot-list"></div><button id="close-robots-btn" class="secondary-btn" data-i18n="action.back"></button></div></section>
      <section id="log-screen" class="screen modal-screen hidden"><div class="upgrade-modal log-modal glass"><div class="upgrade-head"><div><div class="eyebrow" data-i18n="log.eyebrow"></div><h2 data-i18n="log.title"></h2></div><div class="upgrade-wallet"><span data-i18n="hud.clues"></span><strong id="log-clue-count"></strong></div></div><p class="log-intro" data-i18n="log.intro"></p><div id="event-list" class="event-list"></div><button id="close-log-btn" class="secondary-btn" data-i18n="action.back"></button></div></section>
      <section id="end-screen" class="screen modal-screen hidden"><div class="modal end-modal glass"><div id="end-eyebrow" class="eyebrow"></div><h2 id="end-title"></h2><p id="end-copy"></p><div class="result-grid"><div><span data-i18n="end.time"></span><strong id="result-time"></strong></div><div><span data-i18n="end.sold"></span><strong id="result-sold"></strong></div><div><span data-i18n="end.clues"></span><strong id="result-cores"></strong></div></div><button id="checkpoint-end-btn" class="secondary-btn" data-i18n="ui.checkpoint"></button><button id="restart-end-btn" class="primary-btn" data-i18n="action.restart"></button></div></section>`;
    byId("start-btn").onclick = handlers.start; byId("continue-btn").onclick = handlers.continue; byId("resume-btn").onclick = handlers.resume;
    byId("restart-pause-btn").onclick = handlers.restart; byId("restart-end-btn").onclick = handlers.restart; byId("checkpoint-end-btn").onclick = handlers.checkpoint; byId("pause-btn").onclick = handlers.pause;
    byId("mute-btn").onclick = handlers.mute; byId("shop-btn").onclick = handlers.openUpgrades; byId("settings-btn").onclick = handlers.openSettings; byId("title-settings-btn").onclick = handlers.openSettings; byId("robots-btn").onclick = handlers.openRobots;
    byId("log-btn").onclick = handlers.openLog; byId("pause-log-btn").onclick = handlers.openLog; byId("close-log-btn").onclick = handlers.closePanel;
    byId("pause-settings-btn").onclick = handlers.openSettings; byId("tutorial-pause-btn").onclick = handlers.tutorial; byId("close-upgrades-btn").onclick = handlers.closePanel; byId("close-settings-btn").onclick = handlers.closePanel; byId("close-robots-btn").onclick = handlers.closePanel;
    byId("touch-scan").onclick = handlers.scan; byId("touch-interact").onclick = handlers.interact; byId("upgrade-building-btn").onclick = handlers.upgradeBuilding; byId("repair-building-btn").onclick = handlers.repairBuilding;
    byId("hud-battery-btn").onclick = handlers.buyBattery;
    const toggleRelayGuide = () => byId("relay-guide").classList.toggle("hidden");
    byId("relay-help-btn").onclick = toggleRelayGuide; byId("relay-top-btn").onclick = toggleRelayGuide; byId("power-help-btn").onclick = toggleRelayGuide;
    byId("close-relay-help").onclick = () => byId("relay-guide").classList.add("hidden");
    byId("move-building-btn").onclick = handlers.moveBuilding; byId("demolish-building-btn").onclick = handlers.demolishBuilding;
    document.querySelectorAll<HTMLButtonElement>("[data-build]").forEach((button) => button.onclick = () => {
      const value = button.dataset.build!; if (value === "rail") handlers.selectRail(); else handlers.selectBuild(value as BuildingType);
    });
    this.makeShop();
    byId<HTMLSelectElement>("set-language").onchange = (e) => handlers.setting("language", (e.target as HTMLSelectElement).value as Language);
    byId<HTMLSelectElement>("set-quality").onchange = (e) => handlers.setting("quality", (e.target as HTMLSelectElement).value as SettingsView["quality"]);
    byId<HTMLInputElement>("set-volume").oninput = (e) => handlers.setting("volume", Number((e.target as HTMLInputElement).value));
    byId<HTMLInputElement>("set-music-enabled").onchange = (e) => handlers.setting("musicEnabled", (e.target as HTMLInputElement).checked);
    byId<HTMLSelectElement>("set-music-track").onchange = (e) => handlers.setting("musicTrack", (e.target as HTMLSelectElement).value as SettingsView["musicTrack"]);
    byId<HTMLInputElement>("set-music-volume").oninput = (e) => handlers.setting("musicVolume", Number((e.target as HTMLInputElement).value));
    byId<HTMLInputElement>("set-sfx-enabled").onchange = (e) => handlers.setting("sfxEnabled", (e.target as HTMLInputElement).checked);
    byId<HTMLInputElement>("set-sfx-volume").oninput = (e) => handlers.setting("sfxVolume", Number((e.target as HTMLInputElement).value));
    byId<HTMLInputElement>("set-ambience-enabled").onchange = (e) => handlers.setting("ambienceEnabled", (e.target as HTMLInputElement).checked);
    byId<HTMLInputElement>("set-ambience-volume").oninput = (e) => handlers.setting("ambienceVolume", Number((e.target as HTMLInputElement).value));
    byId<HTMLInputElement>("set-shake").onchange = (e) => handlers.setting("cameraShake", (e.target as HTMLInputElement).checked);
    byId<HTMLInputElement>("set-particles").onchange = (e) => handlers.setting("particles", (e.target as HTMLInputElement).checked);
    byId<HTMLSelectElement>("set-scale").onchange = (e) => handlers.setting("uiScale", Number((e.target as HTMLSelectElement).value));
  }

  private t(key: string): string { return translate(this.language, key); }
  private fmt(value: number): string { return new Intl.NumberFormat(locale(this.language)).format(Math.floor(value + 0.0001)); }
  private amount(value: number): string { return new Intl.NumberFormat(locale(this.language), { maximumFractionDigits: 1 }).format(Math.abs(value) < 0.05 ? 0 : value); }
  private area(value: number): string { return new Intl.NumberFormat(locale(this.language), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
  private makeShop(): void {
    const tools = byId("tool-grid");
    for (const tool of TOOLS) {
      const card = document.createElement("article"); card.className = "upgrade-card"; card.id = `tool-${tool.id}`;
      card.innerHTML = `<div class="shop-item"><img class="item-art" src="${shopArt(tool.id)}" alt="" loading="lazy"><div><div class="upgrade-name" data-tool-name="${tool.id}"></div><p data-tool-desc="${tool.id}"></p><span class="level-note" id="tool-level-${tool.id}"></span><pre class="tool-tier-stats" id="tool-stats-${tool.id}"></pre><div class="shop-health"><div><span data-i18n="hud.toolHealth"></span><b id="tool-health-${tool.id}"></b></div><div class="meter"><i id="tool-health-shop-${tool.id}"></i></div></div></div></div><div class="shop-actions"><button class="buy-btn" data-buy-tool="${tool.id}"></button><button class="use-btn" data-use-tool="${tool.id}"></button><button class="repair-btn" data-repair-tool="${tool.id}"></button></div>`;
      card.querySelector<HTMLButtonElement>("[data-buy-tool]")!.onclick = () => this.handlers.buyTool(tool.id);
      card.querySelector<HTMLButtonElement>("[data-use-tool]")!.onclick = () => this.handlers.selectTool(tool.id);
      card.querySelector<HTMLButtonElement>("[data-repair-tool]")!.onclick = () => this.handlers.repairTool(tool.id); tools.appendChild(card);
    }
    const gear = byId("gear-grid");
    for (const upgrade of UPGRADES) {
      const card = document.createElement("article"); card.className = "upgrade-card"; card.id = `gear-${upgrade.id}`;
      card.innerHTML = `<div class="shop-item"><img class="item-art" src="${shopArt(upgrade.id)}" alt="" loading="lazy"><div><div class="upgrade-name" data-upgrade-name="${upgrade.id}"></div><p data-upgrade-desc="${upgrade.id}"></p><span class="level-note" id="gear-level-${upgrade.id}"></span></div></div><button class="buy-btn" data-buy-gear="${upgrade.id}"></button>`;
      card.querySelector("button")!.onclick = () => this.handlers.buyUpgrade(upgrade.id); gear.appendChild(card);
    }
    const battery = document.createElement("article"); battery.className = "upgrade-card"; battery.id = "gear-battery";
    battery.innerHTML = `<div class="shop-item"><img class="item-art" src="${shopArt("battery")}" alt="" loading="lazy"><div><div class="upgrade-name" data-i18n="shop.battery"></div><p data-i18n="shop.batteryDesc"></p><span class="level-note" id="battery-level"></span></div></div><button class="buy-btn" data-buy-battery></button>`;
    battery.querySelector("button")!.onclick = () => this.handlers.buyBattery(); gear.appendChild(battery);
  }

  applyLanguage(language: Language): void {
    this.language = language; document.documentElement.lang = language === "zh" ? "zh-CN" : language; document.documentElement.dir = language === "fa" ? "rtl" : "ltr";
    this.root.dataset.language = language;
    this.root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => { el.textContent = this.t(el.dataset.i18n!); });
    for (const type of buildingOrder) {
      const name = document.querySelector(`[data-building-name="${type}"]`); if (name) name.textContent = this.t(`building.${type}.name`);
      const button = document.querySelector<HTMLButtonElement>(`[data-build="${type}"]`);
      if (button) { button.title = this.t(`building.${type}.desc`); button.setAttribute("aria-label", `${this.t(`building.${type}.name`)} — ${this.t(`building.${type}.desc`)}`); }
    }
    for (const tool of TOOLS) {
      document.querySelector(`[data-tool-name="${tool.id}"]`)!.textContent = this.t(`tool.${tool.id}.name`);
      document.querySelector(`[data-tool-desc="${tool.id}"]`)!.textContent = this.t(`tool.${tool.id}.desc`);
    }
    for (const u of UPGRADES) {
      document.querySelector(`[data-upgrade-name="${u.id}"]`)!.textContent = this.t(`upgrade.${u.id}.name`);
      document.querySelector(`[data-upgrade-desc="${u.id}"]`)!.textContent = this.t(`upgrade.${u.id}.desc`);
    }
  }

  private dismissTransient(): void {
    const toast = byId("toast"); window.clearTimeout(this.toastTimer); this.toastTimer = 0; toast.className = "toast"; toast.textContent = "";
    byId("reward-layer").replaceChildren();
  }

  showState(state: GameState, panel: PausePanel = "menu"): void {
    if (state !== "playing") this.dismissTransient();
    byId("title-screen").classList.toggle("hidden", state !== "title" || panel === "settings");
    byId("pause-screen").classList.toggle("hidden", !(state === "paused" && panel === "menu"));
    byId("upgrade-screen").classList.toggle("hidden", !(state === "paused" && panel === "upgrades"));
    byId("settings-screen").classList.toggle("hidden", panel !== "settings");
    byId("robots-screen").classList.toggle("hidden", !(state === "paused" && panel === "robots"));
    byId("log-screen").classList.toggle("hidden", !(state === "paused" && panel === "log"));
    byId("end-screen").classList.toggle("hidden", (state !== "victory" && state !== "gameover") || panel === "settings");
    const active = state === "playing";
    byId("hud").classList.toggle("hidden", !active); byId("pause-btn").classList.toggle("hidden", !active); byId("shop-btn").classList.toggle("hidden", !active); byId("robots-btn").classList.toggle("hidden", !active); byId("log-btn").classList.toggle("hidden", !active);
    byId("relay-top-btn").classList.toggle("hidden", !active || (this.snapshot?.quest.index ?? 0) < 2);
    byId("build-dock").classList.toggle("hidden", !active); byId("storm-forecast").classList.toggle("hidden", !active);
    byId("desktop-help").classList.toggle("hidden", !active || matchMedia("(pointer: coarse)").matches || innerWidth < 760);
    byId("touch-controls").classList.toggle("hidden", !active || innerHeight > innerWidth || !(matchMedia("(pointer: coarse)").matches || innerWidth < 760));
    if (!active) { byId("prompt").classList.add("hidden"); byId("event-banner").classList.add("hidden"); byId("build-hint").classList.add("hidden"); byId("relay-guide").classList.add("hidden"); this.setDetails(false); }
    if (state === "paused" && panel === "upgrades") this.refreshShop();
    if (state === "paused" && panel === "log" && this.snapshot) this.refreshLog(this.snapshot);
  }

  setDetails(expanded: boolean): void { this.root.classList.toggle("details-expanded", expanded); }

  update(s: GameSnapshot): void {
    if (s.language !== this.language) this.applyLanguage(s.language);
    this.snapshot = s;
    byId("credits-text").textContent = this.fmt(s.credits);
    byId("sales-rate").textContent = `${this.fmt(s.salesPerMinute)}/min`;
    byId("cleanup-text").textContent = `${this.amount(s.cleanupPercent)}%`; byId("cleanup-bar").style.width = `${Math.min(100, s.cleanupPercent)}%`;
    byId("raw-text").textContent = this.amount(s.raw); byId("pure-text").textContent = this.amount(s.purified); byId("ice-text").textContent = this.amount(s.ice);
    byId("load-text").textContent = `${this.amount(s.load)} / ${this.amount(s.capacity)}`; byId("load-bar").style.width = `${Math.min(100, s.load / s.capacity * 100)}%`;
    const tankStatus = byId("tank-status"); tankStatus.textContent = this.t(s.tankReady ? "hud.readySale" : "hud.fillSale"); tankStatus.classList.toggle("ready", s.tankReady);
    tankStatus.title = this.t("hud.cargoHelp");
    byId("objective-text").textContent = `${this.t(s.objective.key)} · ${this.fmt(s.objective.distance)}m`;
    this.root.dataset.storm = s.stormPhase;
    const eta = Math.max(0, s.stormEta);
    byId("storm-eta").textContent = s.stormPhase === "storm"
      ? `${this.t(s.severeStorm ? "storm.severe" : "storm.active")} · ${Math.ceil(s.stormTimer)} ${this.t("storm.seconds")}`
      : `${this.t("storm.approx")} ${timeText(eta)}`;
    byId("storm-forecast-bar").style.width = `${s.stormPhase === "storm" ? 100 : Math.max(2, Math.min(100, (1 - eta / 145) * 100))}%`;
    byId("storm-forecast").classList.toggle("severe", s.severeStorm);
    byId("storm-forecast").title = `${this.t("storm.severe")}: ${this.t("storm.approx")} ${this.fmt(s.stormCount)} / ${this.fmt(s.stormCount + s.stormCycle)}`;
    byId("heat-text").textContent = `${this.fmt(Math.ceil(s.heat))}%`; byId("heat-bar").style.width = `${s.heat}%`; byId("heat-bar").classList.toggle("danger", s.heat < 28);
    byId("power-text").textContent = `${this.fmt(Math.floor(s.power))}%`; byId("power-bar").style.width = `${s.power}%`;
    byId("quest-index").textContent = `${this.fmt(Math.min(s.quest.index + 1, s.quest.total))} / ${this.fmt(s.quest.total)}`;
    byId("quest-title").textContent = this.t(`quest.${s.quest.index}.title`);
    const finalQuest = s.quest.index === 9;
    this.root.querySelector(".quest-card")?.classList.toggle("final-quest", finalQuest);
    byId("quest-desc").textContent = this.t(`quest.${s.quest.index}.desc`) + (finalQuest
      ? `\n${s.cleanupCertified ? "✓" : "○"} ${this.t("hud.cleanup")}: ${s.cleanupCertified ? this.t("hud.certified") : `${this.amount(s.cleanupPercent)}% / ${this.amount(98)}%`}\n${s.cores >= 3 ? "✓" : "○"} ${this.t("hud.clues")}: ${this.fmt(s.cores)} / ${this.fmt(3)}\n${s.power >= 99.99 ? "✓" : "○"} ${this.t("hud.power")}: ${this.fmt(Math.floor(s.power))}% / ${this.amount(100)}%`
      : "");
    byId("quest-progress").textContent = `${this.amount(s.quest.progress)} / ${this.amount(s.quest.target)}`; byId("quest-reward").textContent = s.quest.reward ? `+${this.fmt(s.quest.reward)}` : "";
    byId("quest-bar").style.width = `${Math.min(100, s.quest.progress / s.quest.target * 100)}%`;
    byId("core-pips").innerHTML = s.coreViews.map((c) => `<i class="${c.recovered ? "found" : c.scanned ? "scanned" : ""}"></i>`).join("");
    byId("tool-name").textContent = this.t(`tool.${s.selectedTool}.name`);
    const selectedHealth = s.toolHealth[s.selectedTool]; byId("tool-health-text").textContent = `${this.amount(selectedHealth)}%`;
    byId("tool-health-bar").style.width = `${selectedHealth}%`; byId("tool-health-bar").classList.toggle("danger", selectedHealth < 25);
    const scannerReady = s.scannerCooldown <= 0 && s.radarCharges > 0;
    byId("scanner-text").textContent = `${this.t("hud.charges")} ${this.fmt(s.radarCharges)} / ${this.fmt(s.radarMaxCharges)} · ${s.scannerCooldown > 0 ? `${Math.ceil(s.scannerCooldown)}s` : `${this.fmt(s.scannerRadius)}m`}`;
    byId("scanner-chip").classList.toggle("cooldown", !scannerReady); byId("touch-scan").classList.toggle("disabled", !scannerReady);
    const batteryText = `${this.t("shop.addBattery")} · ${this.fmt(s.radarBatteryCost)} ◈`;
    byId("hud-battery-btn").textContent = batteryText; byId<HTMLButtonElement>("hud-battery-btn").disabled = s.radarCharges >= s.radarMaxCharges || s.credits < s.radarBatteryCost;
    const signal = s.scannerSignal; byId("signal-sector").style.transform = `rotate(${signal.sector * 45}deg)`;
    byId("signal-sector").classList.toggle("active", signal.strength > 0);
    byId("signal-text").textContent = signal.strength > 0 ? `${this.t("hud.signal")} ${this.fmt(signal.strength * 100)}% · ${this.t(signal.band === 2 ? "hud.strong" : signal.band === 1 ? "hud.medium" : "hud.weak")}` : this.t("hud.signalNone");
    byId("signal-bar").style.width = `${signal.strength * 100}%`;
    this.refreshRelays(s);
    byId("relay-top-btn").classList.toggle("hidden", s.state !== "playing" || s.quest.index < 2);
    const robotAlert = byId("robot-alert"); robotAlert.classList.toggle("hidden", s.frozenRobots === 0 || s.state !== "playing");
    byId("robot-alert-text").textContent = `${this.t("hud.robotFrozen")} · ${this.fmt(s.frozenRobots)}`;
    byId("mute-icon").textContent = s.muted ? "🔇" : "🔊";
    const soundAction = this.t(s.muted ? "action.unmute" : "action.mute"); byId("mute-btn").title = soundAction; byId("mute-btn").setAttribute("aria-label", soundAction);
    byId("continue-btn").classList.toggle("hidden", !s.hasSave);
    const event = byId("event-banner");
    byId("storm-forecast").classList.toggle("hidden", s.state !== "playing" || s.stormPhase === "storm");
    if (s.state === "playing" && s.stormPhase !== "calm") {
      event.classList.remove("hidden"); event.classList.toggle("storm", s.stormPhase === "storm");
      byId("event-text").textContent = `${this.t(s.stormPhase === "storm" ? s.severeStorm ? "storm.severe" : "storm.active" : "storm.warning")} · ${Math.ceil(s.stormTimer)} ${this.t("storm.seconds")}`;
    } else event.classList.add("hidden");
    const prompt = byId("prompt"); if (s.state === "playing" && s.prompt) { prompt.classList.remove("hidden"); byId("prompt-text").textContent = s.prompt; } else prompt.classList.add("hidden");
    const hint = byId("build-hint");
    if (s.buildMode) {
      hint.classList.remove("hidden");
      hint.textContent = s.buildMode === "rail"
        ? `${this.t(s.railSource === null ? "prompt.railSource" : "prompt.railTarget")} · ${this.t("prompt.railRotate")}`
        : `${this.t("build.place")} · ${this.t("build.cancel")}`;
    } else hint.classList.add("hidden");
    document.querySelectorAll<HTMLButtonElement>("[data-build]").forEach((button) => {
      const value = button.dataset.build!; const type = value === "rail" ? null : value as BuildingType;
      const locked = type ? s.quest.index < BUILDINGS[type].unlockQuest : s.quest.index < 6;
      button.disabled = locked; button.classList.toggle("locked", locked); button.classList.toggle("selected", s.buildMode === value);
      if (type) document.querySelector(`[data-building-cost="${type}"]`)!.textContent = `${this.fmt(BUILDINGS[type].cost)} ◈`;
    });
    this.updateBuildingCard(s); this.refreshSettings(s.settings);
    if (s.state === "paused" && s.pausePanel === "upgrades") this.refreshShop();
    if (s.state === "paused" && s.pausePanel === "robots") this.refreshRobots(s);
    if (s.state === "paused" && s.pausePanel === "log") this.refreshLog(s);
  }

  private refreshRelays(s: GameSnapshot): void {
    byId("relay-list").innerHTML = s.relays.map((relay) => `<article class="relay-card ${relay.repaired ? "online" : ""}"><div><b>${this.t(`relay.${relay.id}.name`)}</b><span>${this.t(relay.repaired ? "relay.online" : "relay.offline")}</span></div><p>${this.t(`relay.${relay.id}.bonus`)}</p><small>${this.t("relay.warmZone")}: ${this.fmt(relay.warmth)} m · ${this.t("objective.distance")}: ${this.fmt(relay.distance)} m</small><strong>${relay.repaired ? this.t("relay.restored") : `${this.fmt(relay.cost)} ◈ · E`}</strong></article>`).join("");
  }

  private refreshLog(s: GameSnapshot): void {
    const entries = [...s.events.filter((event) => event.kind === "clue").reverse(), ...s.events.filter((event) => event.kind !== "clue").reverse()]; byId("log-clue-count").textContent = `${this.fmt(s.events.filter((event) => event.kind === "clue").length)} / 3`;
    byId("event-list").innerHTML = entries.length ? entries.map((event) => `<article class="event-entry ${event.tone}"><div><span>${this.t(`log.kind.${event.kind}`)}</span><time>${timeText(event.time)}</time></div><p></p></article>`).join("") : `<p class="robot-empty">${this.t("log.empty")}</p>`;
    const texts = byId("event-list").querySelectorAll<HTMLParagraphElement>(".event-entry p"); entries.forEach((event, index) => {
      if (!texts[index]) return;
      const buildingType = event.params?.buildingType, buildingId = event.params?.buildingId;
      texts[index].textContent = event.key?.startsWith("alert.") && buildingType
        ? `${this.t(`building.${buildingType}.name`)} #${buildingId} · ${this.t(event.key)}`
        : event.key ? this.t(event.key) : event.text;
    });
  }

  private updateBuildingCard(s: GameSnapshot): void {
    const card = byId("building-card"); const b = s.nearestBuilding;
    byId("hud").classList.toggle("building-open", !!b);
    if (!b) { card.classList.add("hidden"); return; }
    card.classList.remove("hidden"); card.classList.toggle("damaged", b.damaged);
    byId("building-name").textContent = this.t(`building.${b.type}.name`); byId("building-level").textContent = `${this.t("shop.level")} ${this.fmt(b.level)}`;
    byId("building-desc").textContent = this.t(`building.${b.type}.desc`) + (b.generatorRadius ? ` · ${this.amount(b.generatorRadius)}m` : "");
    const production = byId("building-production"); production.classList.toggle("hidden", b.productionRate === undefined);
    if (b.productionRate !== undefined) {
      byId("building-production-rate").textContent = `${this.amount(b.productionRate)} ${this.t(`build.unit.${b.productionUnit}`)}`;
      byId("building-next-rate").textContent = b.nextProductionRate !== undefined && b.level < 3 ? `${this.t("build.nextLevel")}: ${this.amount(b.nextProductionRate)} ${this.t(`build.unit.${b.productionUnit}`)}` : this.t("shop.max");
    }
    byId("building-status").textContent = b.damaged ? `⚠ ${this.t("build.damaged")}`
      : b.robotFrozen ? `❄ ${this.t("hud.robotFrozen")} · E ${this.t("prompt.rescue")}`
      : b.robotThaw ? `${this.t("hud.thaw")} ${this.fmt(b.robotThaw * 100)}%`
      : !b.powered ? this.t("build.unpowered")
      : b.robotMode ? `${this.t("build.robotMode")}: ${this.t(`robot.mode.${b.robotMode}`)}`
      : this.t("build.powered");
    byId("building-status").classList.toggle("unpowered", b.damaged || !b.powered || !!b.robotFrozen);
    const robotRow = byId("building-robot-row"); robotRow.classList.toggle("hidden", b.robotCarry === undefined || !b.robotCapacity);
    if (b.robotCarry !== undefined && b.robotCapacity) {
      byId("building-robot-tank").textContent = `${this.amount(b.robotCarry)} / ${this.amount(b.robotCapacity)}`;
      byId("building-robot-bar").style.width = `${Math.min(100, b.robotCarry / b.robotCapacity * 100)}%`;
    }
    byId("building-health-row").classList.toggle("hidden", b.robotHealth === undefined);
    if (b.robotHealth !== undefined) { byId("building-robot-health").textContent = `${this.amount(b.robotHealth)}%`; byId("building-robot-health-bar").style.width = `${b.robotHealth}%`; }
    byId("building-input-row").classList.toggle("hidden", b.inputCapacity <= 0);
    byId("building-output-row").classList.toggle("hidden", b.outputCapacity <= 0);
    byId("building-no-storage").classList.toggle("hidden", b.inputCapacity > 0 || b.outputCapacity > 0 || b.robotCarry !== undefined);
    byId("building-input").textContent = `${this.amount(b.input)} / ${this.amount(b.inputCapacity)}`;
    byId("building-output").textContent = `${this.amount(b.output)} / ${this.amount(b.outputCapacity)}`;
    byId("building-input-bar").style.width = `${b.inputCapacity > 0 ? Math.min(100, b.input / b.inputCapacity * 100) : 0}%`;
    byId("building-output-bar").style.width = `${b.outputCapacity > 0 ? Math.min(100, b.output / b.outputCapacity * 100) : 0}%`;
    const source = b.powerSource === "base" ? this.t("power.base") : b.powerSource.startsWith("generator:") ? `${this.t("power.generator")} #${b.powerSource.split(":")[1]}` : this.t("power.none");
    byId("building-power-source").textContent = source;
    byId("building-power-load").textContent = b.powerCapacity > 0 ? `${this.fmt(b.powerLoad)} / ${this.fmt(b.powerCapacity)}` : "—";
    byId("building-efficiency").textContent = b.powerCapacity > 0 ? `${this.fmt(b.powerEfficiency * 100)}%` : "—";
    byId("building-cable-label").classList.toggle("hidden", b.type !== "generator"); byId("building-cable").classList.toggle("hidden", b.type !== "generator");
    byId("building-cable").textContent = this.t(b.cableConnected ? "build.connected" : "build.disconnected");
    const repair = byId<HTMLButtonElement>("repair-building-btn"); const serviceCost = b.robotServiceCost ?? 0;
    repair.classList.toggle("hidden", !b.damaged && serviceCost <= 0);
    const repairCost = b.damaged ? b.repairCost : serviceCost;
    repair.textContent = `${this.t(b.damaged ? "action.repair" : "action.serviceRobot")} · ${this.fmt(repairCost)} ◈`; repair.disabled = s.credits < repairCost;
    const button = byId<HTMLButtonElement>("upgrade-building-btn"); button.textContent = b.level >= 3 ? this.t("shop.max") : `${this.t("action.upgrade")} · ${this.fmt(BUILDINGS[b.type].upgradeCost * b.level)} ◈`;
    button.disabled = b.damaged || b.level >= 3 || s.credits < BUILDINGS[b.type].upgradeCost * b.level;
  }

  private refreshRobots(s: GameSnapshot): void {
    const buildings = s.buildings.filter((b) => b.robots && b.robots.length > 0);
    byId("robot-total").textContent = this.fmt(s.robotCount);
    byId("robot-list").innerHTML = buildings.length ? buildings.flatMap((b) => b.robots!.map((r) => {
      const ownCapacity = Math.max(1, r.capacity);
      const output = b.outputCapacity > 0 && r.slot === 0 ? `<div class="robot-meter-label"><span>${this.t("build.dockTank")}</span><b>${this.amount(b.output)} / ${this.amount(b.outputCapacity)}</b></div><div class="meter"><i style="width:${Math.min(100, b.output / b.outputCapacity * 100)}%"></i></div>` : "";
      const tank = r.kind === "sweeper" ? `<div class="robot-meter-label"><span>${this.t("build.robotTank")}</span><b>${this.amount(r.carry)} / ${this.amount(r.capacity)}</b></div><div class="meter"><i style="width:${Math.min(100, r.carry / ownCapacity * 100)}%"></i></div>` : `<div class="robot-meter-label"><span>${this.t("robot.energy")}</span><b>${this.amount(r.energy)}%</b></div><div class="meter robot-energy-meter"><i style="width:${r.energy}%"></i></div>`;
      let zones = "";
      if (r.kind === "sweeper") {
        const mode = r.zoneMode ?? (r.zoneAuto ? "auto" : "custom"); const chunkArea = s.chunkSize * s.chunkSize;
        const localArea = Math.PI * r.zoneRange * r.zoneRange; const active = s.chunks.find((chunk) => chunk.id === r.activeChunk);
        const queued = r.chunkIds.map((id) => s.chunks[id]?.name).filter(Boolean).join(" · ") || "—";
        const chunkButtons = s.chunks.map((chunk) => `<button class="chunk-cell ${chunk.id === r.activeChunk ? "active" : ""} ${r.chunkIds.includes(chunk.id) ? "queued" : ""} ${chunk.remaining < 0.55 ? "clean" : ""}" style="--clean:${Math.round(chunk.progress * 100)}%" data-chunk-mode="${b.id}:${r.slot}" data-chunk-id="${chunk.id}" title="${chunk.name} · ${this.amount(chunk.remaining)} ${this.t("robot.remaining")}" aria-label="${chunk.name}"><span>${chunk.name}</span></button>`).join("");
        zones = `<div class="robot-zone robot-chunks"><div class="zone-mode-row"><label><span>${this.t("robot.zone")}</span><select data-zone-mode="${b.id}:${r.slot}"><option value="auto" ${mode === "auto" ? "selected" : ""}>${this.t("robot.zoneAuto")}</option><option value="follow" ${mode === "follow" ? "selected" : ""}>${this.t("robot.zoneFollow")}</option><option value="custom" ${mode === "custom" ? "selected" : ""}>${this.t("robot.zoneCustom")}</option></select></label><div class="chunk-quota"><span>${this.t("robot.chunkQuota")}</span><b>${r.chunkQuota} × ${this.area(chunkArea)} m² = ${this.area(r.chunkQuota * chunkArea)} m²</b></div></div><div class="zone-measurements"><span>${this.t(mode === "auto" ? "robot.aroundDock" : mode === "follow" ? "robot.aroundPlayer" : "robot.aroundChunk")}</span><b>${this.area(r.zoneRange)} m · ${this.area(localArea)} m²</b></div><p class="zone-explain">${this.t("robot.zoneHint")}</p><div class="active-chunk"><span>${this.t("robot.activeChunk")}: <b>${active?.name ?? "—"}</b> · ${this.amount(r.chunkProgress * 100)}%</span><span>${this.t("robot.queue")}: ${queued}</span></div><div class="chunk-map" style="--chunk-columns:${s.chunkColumns}">${chunkButtons}</div><small class="chunk-legend">${this.t("robot.chunkLegend")} · ${s.chunkColumns} × ${s.chunkColumns} = ${s.chunks.length} · ${this.area(s.chunkSize)} m / ${this.area(chunkArea)} m²</small></div>`;
      }
      const purchase = b.type === "sweeper" && r.slot === b.robots!.length - 1 && b.robots!.length < b.level ? `<button class="buy-btn extra-robot-btn" data-buy-robot="${b.id}" ${b.damaged || s.credits < (b.extraRobotCost ?? 0) ? "disabled" : ""}>${this.t("robot.buyExtra")} · ${this.fmt(b.extraRobotCost ?? 0)} ◈ (${b.robots!.length}/${b.level})</button>` : "";
      const rescuePolicy = r.kind === "hauler" ? `<label class="rescue-policy"><input type="checkbox" data-repair-allowed="${b.id}:${r.slot}" ${r.repairAllowed ? "checked" : ""}><span>${this.t("robot.allowRepairs")}</span></label><small class="rescue-costs">${this.t("robot.rescueCosts")}</small>` : "";
      return `<article class="robot-card ${b.damaged ? "damaged" : ""} ${r.kind === "sweeper" ? "sweeper-card" : ""}"><div class="robot-card-head"><b>${this.t(`building.${b.type}.name`)} #${b.id} · ${this.t("robot.unit")} ${r.slot + 1}</b><span>${this.t(b.damaged ? "robot.mode.damaged" : r.frozen ? "hud.robotFrozen" : b.powered ? "build.powered" : "build.unpowered")}</span></div><p>${this.t(`robot.role.${r.kind}`)}</p><div class="robot-mode">${this.t("build.robotMode")}: <b>${this.t(`robot.mode.${r.mode}`)}</b></div><div class="robot-meter-label"><span>${this.t("hud.robotHealth")}</span><b>${this.amount(r.health)}%</b></div><div class="meter robot-health-meter"><i style="width:${r.health}%"></i></div>${tank}${output}${zones}<div class="robot-telemetry"><span>${this.t("build.robotTemp")}: ${this.fmt(r.temperature)}%</span><span>${this.t("build.efficiency")}: ${b.powerCapacity ? this.fmt(b.powerEfficiency * 100) : 0}%</span></div>${rescuePolicy}${purchase}</article>`;
    })).join("") : `<p class="robot-empty">${this.t("robot.empty")}</p>`;
    byId("robot-list").querySelectorAll<HTMLButtonElement>("[data-buy-robot]").forEach((button) => button.onclick = () => this.handlers.buyExtraRobot(Number(button.dataset.buyRobot)));
    byId("robot-list").querySelectorAll<HTMLInputElement>("[data-repair-allowed]").forEach((input) => input.onchange = () => {
      const [buildingId, slot] = input.dataset.repairAllowed!.split(":").map(Number);
      this.handlers.robotRepairAllowed(buildingId, slot, input.checked);
    });
    byId("robot-list").querySelectorAll<HTMLSelectElement>("[data-zone-mode]").forEach((select) => select.onchange = () => {
      const [buildingId, slot] = select.dataset.zoneMode!.split(":").map(Number); const robot = s.buildings.find((b) => b.id === buildingId)?.robots?.find((r) => r.slot === slot);
      this.handlers.robotZoneMode(buildingId, slot, select.value as RobotZoneMode, select.value === "custom" ? Math.max(0, robot?.activeChunk ?? 0) : undefined);
    });
    byId("robot-list").querySelectorAll<HTMLButtonElement>("[data-chunk-mode]").forEach((button) => button.onclick = () => {
      const [buildingId, slot] = button.dataset.chunkMode!.split(":").map(Number); this.handlers.robotZoneMode(buildingId, slot, "custom", Number(button.dataset.chunkId));
    });
  }

  private refreshShop(): void {
    const s = this.snapshot; if (!s) return; byId("upgrade-credits").textContent = this.fmt(s.credits);
    for (const tool of TOOLS) {
      const level = s.tools[tool.id]; const locked = s.quest.index < tool.unlockQuest; const card = byId(`tool-${tool.id}`); card.classList.toggle("owned", level > 0); card.classList.toggle("locked", locked);
      const buy = card.querySelector<HTMLButtonElement>("[data-buy-tool]")!; const use = card.querySelector<HTMLButtonElement>("[data-use-tool]")!; const repair = card.querySelector<HTMLButtonElement>("[data-repair-tool]")!;
      const health = s.toolHealth[tool.id]; const repairCost = toolRepairCost(tool.id, level);
      byId(`tool-health-${tool.id}`).textContent = `${this.amount(health)}%`; byId(`tool-health-shop-${tool.id}`).style.width = `${health}%`;
      repair.textContent = health >= 99.99 ? this.t("shop.healthy") : `${this.t("action.repair")} · ${this.fmt(repairCost)} ◈`;
      repair.disabled = level === 0 || health >= 99.99 || s.credits < repairCost;
      const cost = level >= 4 ? 0 : level === 0 ? tool.cost : TOOL_UPGRADES[tool.id][level - 1];
      buy.textContent = locked ? this.t("toast.locked") : level >= 4 ? this.t("shop.max") : `${this.t("shop.buy")} · ${this.fmt(cost)} ◈`;
      buy.disabled = locked || level >= 4 || s.credits < cost;
      use.textContent = s.selectedTool === tool.id ? this.t("shop.equipped") : this.t("shop.use"); use.disabled = level === 0 || s.selectedTool === tool.id;
      const stats = toolTierStats(tool.id, level); const next = level > 0 && level < 4 ? toolTierStats(tool.id, level + 1) : null;
      byId(`tool-level-${tool.id}`).textContent = `${level ? `${this.t("shop.level")} ${this.fmt(level)} · ` : ""}${this.t("hud.capacity")} ${this.fmt(stats.capacity)}${next ? ` → ${this.fmt(next.capacity)}` : ""}`;
      const detail = byId(`tool-stats-${tool.id}`);
      detail.textContent = `${this.t("tool.statSpeed")} ${this.amount(stats.rate)}${next ? ` → ${this.amount(next.rate)}` : ""} · ${this.t("tool.statRadius")} ${this.amount(stats.radius)}${next ? ` → ${this.amount(next.radius)}` : ""} m\n${this.t("tool.statPower")} ${this.fmt(stats.yield * 100)}%${next ? ` → ${this.fmt(next.yield * 100)}%` : ""} · ${this.t("tool.statArea")} ${this.amount(stats.area)} m²`;
      detail.title = this.t("tool.statUpgradeHint");
    }
    for (const u of UPGRADES) {
      const level = s.upgrades[u.id]; const cost = u.costs[level] ?? 0; const button = document.querySelector<HTMLButtonElement>(`[data-buy-gear="${u.id}"]`)!;
      button.textContent = level >= 3 ? this.t("shop.max") : `${this.t("shop.buy")} · ${this.fmt(cost)} ◈`; button.disabled = level >= 3 || s.credits < cost;
      byId(`gear-${u.id}`).classList.toggle("owned", level > 0); byId(`gear-level-${u.id}`).textContent = `${this.t("shop.level")} ${this.fmt(level)} / 3`;
    }
    byId("battery-level").textContent = `${this.t("hud.charges")} ${this.fmt(s.radarCharges)} / ${this.fmt(s.radarMaxCharges)}`;
    const battery = document.querySelector<HTMLButtonElement>("[data-buy-battery]")!;
    battery.textContent = s.radarCharges >= s.radarMaxCharges ? this.t("shop.max") : `${this.t("shop.addBattery")} · ${this.fmt(s.radarBatteryCost)} ◈`;
    battery.disabled = s.radarCharges >= s.radarMaxCharges || s.credits < s.radarBatteryCost;
  }

  private refreshSettings(settings: SettingsView): void {
    byId<HTMLSelectElement>("set-language").value = settings.language; byId<HTMLSelectElement>("set-quality").value = settings.quality;
    byId<HTMLInputElement>("set-volume").value = String(settings.volume);
    byId<HTMLInputElement>("set-music-enabled").checked = settings.musicEnabled; byId<HTMLSelectElement>("set-music-track").value = settings.musicTrack;
    byId<HTMLInputElement>("set-music-volume").value = String(settings.musicVolume);
    byId<HTMLInputElement>("set-sfx-enabled").checked = settings.sfxEnabled; byId<HTMLInputElement>("set-sfx-volume").value = String(settings.sfxVolume);
    byId<HTMLInputElement>("set-ambience-enabled").checked = settings.ambienceEnabled; byId<HTMLInputElement>("set-ambience-volume").value = String(settings.ambienceVolume);
    byId<HTMLInputElement>("set-shake").checked = settings.cameraShake;
    byId<HTMLInputElement>("set-particles").checked = settings.particles; byId<HTMLSelectElement>("set-scale").value = String(settings.uiScale);
    this.root.style.setProperty("--ui-scale", String(settings.uiScale));
  }
  showEnd(victory: boolean, s: GameSnapshot): void {
    byId("end-eyebrow").textContent = this.t(victory ? "end.winEyebrow" : "end.loseEyebrow");
    byId("checkpoint-end-btn").classList.toggle("hidden", victory);
    byId("end-title").textContent = this.t(victory ? "end.winTitle" : "end.loseTitle"); byId("end-copy").textContent = this.t(victory ? "end.winCopy" : "end.loseCopy");
    byId("result-time").textContent = timeText(s.runTime); byId("result-sold").textContent = this.fmt(s.sold); byId("result-cores").textContent = `${this.fmt(s.cores)} / 3`;
  }
  reward(text: string): void {
    const layer = byId("reward-layer"); const pop = document.createElement("div"); pop.className = "reward-pop";
    pop.innerHTML = `<span>✦</span><b>${text}</b>`; layer.appendChild(pop);
    window.setTimeout(() => pop.remove(), 1500);
  }
  notify(text: string, tone: "info" | "warm" | "danger" = "info"): void {
    const toast = byId("toast"); window.clearTimeout(this.toastTimer); toast.textContent = text; toast.className = `toast show ${tone}`;
    this.toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3000);
  }
  dispose(): void { window.clearTimeout(this.toastTimer); this.root.innerHTML = ""; }
}
