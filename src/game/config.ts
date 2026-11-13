export const INPUT_CONFIG = {
  MOUSE_SENS_X: 0.0026, MOUSE_SENS_Y: 0.0022,
  INVERT_X: false, INVERT_Y: false,
} as const;

export const GAME = {
  seed: 741203,
  worldSize: 140.4,
  worldLimit: 66.15,
  playerSpeed: 5.6,
  sprintMultiplier: 1.62,
  sprintHeatMultiplier: 1.35,
  playerRadius: 0.48,
  scannerRadius: 30,
  scannerCooldown: 6,
  heatDrain: 0.95,
  stormHeatDrain: 2.8,
  stormSpeedMultiplier: 0.68,
  stormWindPush: 1.15,
  windX: -0.86,
  windZ: 0.51,
  heatRecharge: 24,
  firstStormAt: 150,
  stormIntervalMin: 85,
  stormIntervalMax: 145,
  stormWarning: 12,
  stormDuration: 25,
  severeStormDuration: 38,
  stormRegrowChance: 0.18,
  baseCenter: { x: 0, z: 10 },
  baseHeatRadius: 9,
  basePowerRadius: 19,
  basePowerConnections: 6,
  generatorRadius: 18,
  generatorCableRange: 68,
  radar: { x: -33.75, z: -36.45 },
  radarActivationCost: 180,
  depot: { x: 7, z: 8 },
  fabricator: { x: -7, z: 8 },
  spawn: { x: 0, z: 2 },
  saveKey: "career-v2",
} as const;

export const QUALITY = {
  PARTICLES_HIGH: 650, PARTICLES_LOW: 150, SPRAY_POOL: 240,
  DEGRADE_FPS: 38, RESTORE_FPS: 55, MAX_DRAW_CALLS: 280, MAX_TRIANGLES: 420_000,
} as const;

export const COLORS = {
  sky: 0x102a3a, fog: 0x17394a, snow: 0xe4f3f4, ice: 0x315b68,
  cyan: 0x65e6d7, orange: 0xff8b51, warm: 0xffcf78,
  metal: 0x3d5963, dark: 0x132c37, cream: 0xe8e4d5,
} as const;
