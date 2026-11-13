import * as THREE from "three";

/** Dispose per-instance GPU resources without touching shared GLB geometry/materials. */
export function disposeObject(root: THREE.Object3D, disposeMaterials = false): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    let shared = false;
    for (let current: THREE.Object3D | null = object; current && current !== root.parent; current = current.parent) {
      if (current.userData.sharedResources) { shared = true; break; }
    }
    if (shared) return;
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) geometries.add(object.geometry);
    if (disposeMaterials && (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite)) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
}
