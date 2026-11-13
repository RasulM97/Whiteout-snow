import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function between(a: THREE.Vector3, b: THREE.Vector3, radius: number): THREE.BufferGeometry {
  const direction = b.clone().sub(a); const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius * 0.72, radius, length, 5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  geometry.applyQuaternion(quaternion); geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geometry;
}

/** Layered boughs with small windward snow pillows, never a single cone cap. */
export function createSnowPineGeometries(): { trunk: THREE.BufferGeometry; foliage: THREE.BufferGeometry; snow: THREE.BufferGeometry } {
  const wood: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.12, 0.21, 2.1, 7).translate(0, 1.05, 0)];
  const needles: THREE.BufferGeometry[] = []; const snow: THREE.BufferGeometry[] = [];
  for (let tier = 0; tier < 4; tier++) {
    const y = 1.65 + tier * 0.62; const radius = 1.18 - tier * 0.2; const height = 1.52 - tier * 0.12;
    const bough = new THREE.ConeGeometry(radius, height, 9);
    bough.rotateY(tier * 0.37); bough.translate(0, y + 0.38, 0); needles.push(bough);
    const branches = tier < 3 ? 5 : 3;
    for (let branch = 0; branch < branches; branch++) {
      const angle = branch / branches * Math.PI * 2 + tier * 0.73;
      const outer = radius * 0.77;
      const end = new THREE.Vector3(Math.sin(angle) * outer, y + 0.06, Math.cos(angle) * outer);
      wood.push(between(new THREE.Vector3(0, y + 0.18, 0), end, 0.045));
      const pillow = new THREE.IcosahedronGeometry(0.36 - tier * 0.025, 1);
      pillow.scale(1.2, 0.24, 0.7); pillow.rotateY(angle);
      pillow.translate(end.x * 0.88, end.y + 0.18, end.z * 0.88); snow.push(pillow);
    }
  }
  const crown = new THREE.IcosahedronGeometry(0.25, 1); crown.scale(0.8, 1.25, 0.8); crown.translate(0, 4.03, 0); snow.push(crown);
  const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
    const geometry = mergeGeometries(parts, false)!;
    for (const part of parts) part.dispose();
    geometry.computeVertexNormals(); return geometry;
  };
  return { trunk: merge(wood), foliage: merge(needles), snow: merge(snow) };
}
