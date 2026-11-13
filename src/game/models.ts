import * as THREE from "three";

export type ModelName = "sweeper-bot" | "purifier" | "ice-press";

/**
 * Lightweight procedural art direction. The previous static GLBs duplicated the
 * animated rigs, added several megabytes and froze their moving parts, so the
 * game now intentionally keeps the crafted, articulated models in every view.
 */
export class ModelLibrary {
  async attach(_parent: THREE.Group, _name: ModelName, _height: number, _fallback?: THREE.Object3D): Promise<THREE.Group | null> { return null; }
  async attachGhost(_parent: THREE.Group, _name: ModelName, _height: number, _fallback?: THREE.Object3D): Promise<THREE.Group | null> { return null; }
  dispose(): void { /* Procedural models are owned and disposed by their systems. */ }
}
