import type { RailPathPoint } from "./rails";

/** Keep the player's pencil stroke, without storing every jittered sample. */
export function simplifyStroke(raw: RailPathPoint[]): RailPathPoint[] {
  const spaced: RailPathPoint[] = [];
  for (const point of raw) {
    const last = spaced[spaced.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.z - last.z) >= 0.4) spaced.push({ x: point.x, z: point.z });
  }
  const reduced = rdp(spaced, 0.48);
  return fillet(reduced, 1.65);
}

function rdp(points: RailPathPoint[], epsilon: number): RailPathPoint[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  let farthest = 0;
  let index = 0;
  const a = points[0];
  const b = points[points.length - 1];
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  for (let i = 1; i < points.length - 1; i++) {
    const t = len2 < 1e-6 ? 0 : ((points[i].x - a.x) * abx + (points[i].z - a.z) * abz) / len2;
    const clamped = Math.max(0, Math.min(1, t));
    const dx = points[i].x - (a.x + abx * clamped);
    const dz = points[i].z - (a.z + abz * clamped);
    const dist = Math.hypot(dx, dz);
    if (dist > farthest) { farthest = dist; index = i; }
  }
  if (farthest <= epsilon) return [{ ...a }, { ...b }];
  return [...rdp(points.slice(0, index + 1), epsilon).slice(0, -1), ...rdp(points.slice(index), epsilon)];
}

/** Soften corners that would kink sharper than the guideway can turn. */
function fillet(points: RailPathPoint[], radius: number): RailPathPoint[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  const out: RailPathPoint[] = [{ ...points[0] }];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const inX = curr.x - prev.x;
    const inZ = curr.z - prev.z;
    const outX = next.x - curr.x;
    const outZ = next.z - curr.z;
    const inLen = Math.hypot(inX, inZ);
    const outLen = Math.hypot(outX, outZ);
    if (inLen < 0.2 || outLen < 0.2) { out.push({ ...curr }); continue; }
    const dot = (inX * outX + inZ * outZ) / (inLen * outLen);
    if (dot > 0.84) { out.push({ ...curr }); continue; }
    const trim = Math.min(radius, inLen * 0.45, outLen * 0.45);
    const a = { x: curr.x - inX / inLen * trim, z: curr.z - inZ / inLen * trim };
    const b = { x: curr.x + outX / outLen * trim, z: curr.z + outZ / outLen * trim };
    out.push(a);
    for (let step = 1; step < 4; step++) {
      const t = step / 4;
      const u = 1 - t;
      out.push({ x: u * u * a.x + 2 * u * t * curr.x + t * t * b.x, z: u * u * a.z + 2 * u * t * curr.z + t * t * b.z });
    }
    out.push(b);
  }
  out.push({ ...points[points.length - 1] });
  return out;
}
