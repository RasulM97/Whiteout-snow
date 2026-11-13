import { TOOLS, TOOL_CAPACITIES, type ToolDefinition, type ToolId } from "./types";

export interface ToolTierStats {
  level: number;
  radius: number;
  rate: number;
  yield: number;
  distance: number;
  capacity: number;
  area: number;
}

/**
 * One balance source for gameplay and the shop. Every tier improves all four
 * useful dimensions: coverage, clearing speed, recovery power and tank size.
 */
export function toolTierStats(id: ToolId, ownedLevel: number): ToolTierStats {
  const definition = TOOLS.find((tool) => tool.id === id) as ToolDefinition;
  const level = Math.max(1, Math.min(4, Math.floor(ownedLevel || 1)));
  const tier = level - 1;
  const radius = definition.radius * (1 + tier * 0.18);
  return {
    level,
    radius,
    rate: definition.rate * (1 + tier * 0.32),
    yield: definition.yield * (1 + tier * 0.15),
    distance: definition.distance * (1 + tier * 0.1),
    capacity: TOOL_CAPACITIES[id][tier],
    area: Math.PI * radius * radius,
  };
}
