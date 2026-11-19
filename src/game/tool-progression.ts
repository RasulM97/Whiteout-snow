import { TOOL_CAPACITIES, type ToolId } from "./types";

export interface ToolTierStats {
  level: number;
  radius: number;
  rate: number;
  yield: number;
  distance: number;
  capacity: number;
  area: number;
  /** Durability lost per second of real removal, relative to the old 0.065 baseline. */
  wear: number;
  /** Move multiplier while the clear button is held. */
  pace: number;
  /** Heat-drain multiplier while clearing. */
  heat: number;
  /** Extra bite against packed snow. Zero means density is ignored. */
  focus: number;
  /** Extra speed against thin film. Zero means density is ignored. */
  film: number;
  /** Speed kept while wading through deep snow. 1 ignores depth. */
  wade: number;
}

/**
 * Purchased levels stay on the existing capacity table. Higher tiers improve
 * that tool's job instead of making every tool better at everything.
 * Hands stay precise, the shovel bites packed snow, the brush sweeps shallow
 * film, the blower reaches, and the vacuum keeps cargo.
 * Radius bands stay inside the snow grid so an upgrade cannot jump from one
 * cell to a whole neighborhood. Film tools slow down as snow gets packed.
 */
const ROLE: Record<ToolId, Omit<ToolTierStats, "level" | "capacity" | "area">> = {
  hands: {
    radius: 0.66, rate: 1.2, yield: 0.88, distance: 0.85, wear: 0.42, pace: 1, heat: 1, focus: 0, film: 0, wade: 0.62,
  },
  shovel: {
    radius: 1.05, rate: 1.85, yield: 0.6, distance: 1.05, wear: 0.88, pace: 0.94, heat: 1.02, focus: 1.25, film: 0, wade: 1,
  },
  brush: {
    radius: 1.46, rate: 1.4, yield: 0.36, distance: 1.28, wear: 0.7, pace: 1.04, heat: 1, focus: 0, film: 0.95, wade: 0.7,
  },
  blower: {
    radius: 1.28, rate: 1.35, yield: 0.5, distance: 3.7, wear: 0.78, pace: 0.98, heat: 0.72, focus: 0, film: 0, wade: 0.88,
  },
  vacuum: {
    radius: 1.08, rate: 2.15, yield: 0.8, distance: 1.55, wear: 1.35, pace: 0.74, heat: 1.14, focus: 0, film: 0, wade: 0.7,
  },
};

const GROWTH: Record<ToolId, Omit<ToolTierStats, "level" | "capacity" | "area">> = {
  hands: { radius: 0.04, rate: 0.22, yield: 0.03, distance: 0.04, wear: -0.07, pace: 0, heat: 0, focus: 0, film: 0, wade: 0 },
  shovel: { radius: 0.04, rate: 0.42, yield: 0.02, distance: 0.05, wear: -0.06, pace: 0.01, heat: 0, focus: 0.28, film: 0, wade: 0 },
  brush: { radius: 0.06, rate: 0.2, yield: 0.02, distance: 0.06, wear: -0.05, pace: 0.01, heat: 0, focus: 0, film: 0.18, wade: 0 },
  blower: { radius: 0.05, rate: 0.16, yield: 0.02, distance: 0.7, wear: -0.05, pace: 0, heat: -0.06, focus: 0, film: 0, wade: 0 },
  vacuum: { radius: 0.035, rate: 0.55, yield: 0.03, distance: 0.06, wear: -0.1, pace: 0.03, heat: -0.02, focus: 0, film: 0, wade: 0 },
};

export function toolTierStats(id: ToolId, ownedLevel: number): ToolTierStats {
  const level = Math.max(1, Math.min(4, Math.floor(ownedLevel || 1)));
  const tier = level - 1;
  const base = ROLE[id];
  const growth = GROWTH[id];
  const radius = base.radius + growth.radius * tier;
  return {
    level,
    radius,
    rate: base.rate + growth.rate * tier,
    yield: Math.min(1, base.yield + growth.yield * tier),
    distance: base.distance + growth.distance * tier,
    capacity: TOOL_CAPACITIES[id][tier],
    area: Math.PI * radius * radius,
    wear: Math.max(0.15, base.wear + growth.wear * tier),
    pace: base.pace + growth.pace * tier,
    heat: base.heat + growth.heat * tier,
    focus: base.focus + growth.focus * tier,
    film: base.film + growth.film * tier,
    wade: base.wade + growth.wade * tier,
  };
}

/**
 * Shared by the player and the shop. Yield never exceeds the snow actually removed.
 * A crust tool is weak on film. A film tool is weak on packed snow.
 * The player applies this per cell, so a thin center cannot speed up packed snow around it.
 */
export function toolClearRate(stats: ToolTierStats, density: number): number {
  const packed = Math.max(0, Math.min(1, density));
  let rate = stats.rate;
  if (stats.focus > 0) rate *= 0.32 + stats.focus * packed;
  else if (stats.film > 0) rate *= (1 + stats.film) * (1 - packed) + 0.16 * packed;
  return Math.max(0.05, rate);
}
