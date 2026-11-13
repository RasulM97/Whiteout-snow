import * as THREE from "three";
import { COLORS, GAME, QUALITY } from "./config";

function randomSource(seed: number): () => number { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const REWARD_POOL = 160;
const FOOTPRINT_POOL = 180;
const STREAK_POOL = 150;

export class Effects {
  private random = randomSource(GAME.seed + 300);
  private snowGeo = new THREE.BufferGeometry();
  private snowPos = new Float32Array(QUALITY.PARTICLES_HIGH * 3);
  private snowSpeed = new Float32Array(QUALITY.PARTICLES_HIGH);
  private snowPoints: THREE.Points;
  private snowMat: THREE.PointsMaterial;
  private sprayGeo = new THREE.BufferGeometry();
  private sprayPoints: THREE.Points;
  private sprayPos = new Float32Array(QUALITY.SPRAY_POOL * 3);
  private sprayVel = new Float32Array(QUALITY.SPRAY_POOL * 3);
  private sprayLife = new Float32Array(QUALITY.SPRAY_POOL);
  private sprayCursor = 0;
  private scanRing: THREE.Mesh;
  private scanLife = 0;
  private streakGeo = new THREE.BufferGeometry();
  private streakPos = new Float32Array(STREAK_POOL * 6);
  private streakSpeed = new Float32Array(STREAK_POOL);
  private streakLines: THREE.LineSegments;
  private streakMat: THREE.LineBasicMaterial;
  private footprints: THREE.InstancedMesh;
  private footprintCursor = 0;
  private footprintTotal = 0;
  private footprintAges = new Float32Array(180);
  private activeFootprints = 0;
  private footprintMatrix = new THREE.Matrix4();
  private dummy = new THREE.Object3D();
  private rewardGeo = new THREE.BufferGeometry();
  private rewardPos = new Float32Array(REWARD_POOL * 3);
  private rewardVel = new Float32Array(REWARD_POOL * 3);
  private rewardColor = new Float32Array(REWARD_POOL * 3);
  private rewardLife = new Float32Array(REWARD_POOL);
  private rewardCursor = 0;
  private rewardPoints: THREE.Points;
  private color = new THREE.Color();
  private particlesEnabled = true;
  private stormAmount = 0;
  readonly targetRing: THREE.Mesh;
  lowQuality = false;
  get footprintTotalCount(): number { return this.footprintTotal; }
  get activeFootprintCount(): number { return this.activeFootprints; }
  get stormVisible(): boolean { return this.streakLines.visible; }

  constructor(private scene: THREE.Scene) {
    for (let i = 0; i < QUALITY.PARTICLES_HIGH; i++) this.resetFlake(i, true);
    this.snowGeo.setAttribute("position", new THREE.BufferAttribute(this.snowPos, 3));
    this.snowMat = new THREE.PointsMaterial({ color: 0xe4f5ff, size: 0.11, transparent: true, opacity: 0.55, depthWrite: false });
    this.snowPoints = new THREE.Points(this.snowGeo, this.snowMat); this.snowPoints.frustumCulled = false; scene.add(this.snowPoints);
    this.sprayPos.fill(-100); this.sprayGeo.setAttribute("position", new THREE.BufferAttribute(this.sprayPos, 3));
    this.sprayPoints = new THREE.Points(this.sprayGeo, new THREE.PointsMaterial({ color: 0xe9fbff, size: 0.16, transparent: true, opacity: 0.85, depthWrite: false })); this.sprayPoints.frustumCulled = false; scene.add(this.sprayPoints);
    this.scanRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64), new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scanRing.rotation.x = -Math.PI / 2; scene.add(this.scanRing);
    this.targetRing = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 48), new THREE.MeshBasicMaterial({ color: 0x087f89, transparent: true, opacity: 0.48, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    this.targetRing.rotation.x = -Math.PI / 2; this.targetRing.position.y = 0.09; scene.add(this.targetRing);

    for (let i = 0; i < STREAK_POOL; i++) this.resetStreak(i, true);
    this.streakGeo.setAttribute("position", new THREE.BufferAttribute(this.streakPos, 3));
    this.streakMat = new THREE.LineBasicMaterial({ color: 0xe3f7ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.streakLines = new THREE.LineSegments(this.streakGeo, this.streakMat); this.streakLines.frustumCulled = false; this.streakLines.visible = false; scene.add(this.streakLines);

    const footGeo = new THREE.CircleGeometry(1, 12); footGeo.rotateX(-Math.PI / 2);
    this.footprints = new THREE.InstancedMesh(footGeo, new THREE.MeshBasicMaterial({ color: 0x315d68, transparent: true, opacity: 0.25, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), FOOTPRINT_POOL);
    this.footprints.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.footprints.frustumCulled = false; scene.add(this.footprints);
    this.clearFootprints();

    this.rewardPos.fill(-100); this.rewardGeo.setAttribute("position", new THREE.BufferAttribute(this.rewardPos, 3)); this.rewardGeo.setAttribute("color", new THREE.BufferAttribute(this.rewardColor, 3));
    this.rewardPoints = new THREE.Points(this.rewardGeo, new THREE.PointsMaterial({ size: 0.19, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.rewardPoints.frustumCulled = false; scene.add(this.rewardPoints);
  }
  private resetFlake(i: number, initial = false): void {
    this.snowPos[i * 3] = (this.random() - 0.5) * 64;
    this.snowPos[i * 3 + 1] = initial ? this.random() * 22 : 18 + this.random() * 6;
    this.snowPos[i * 3 + 2] = (this.random() - 0.5) * 64;
    this.snowSpeed[i] = 2.4 + this.random() * 3.6;
  }
  private resetStreak(i: number, initial = false): void {
    const x = (this.random() - 0.5) * 48, y = initial ? this.random() * 16 : 12 + this.random() * 8, z = (this.random() - 0.5) * 48;
    const p = i * 6; this.streakPos[p] = x; this.streakPos[p + 1] = y; this.streakPos[p + 2] = z;
    this.streakPos[p + 3] = x - 1.25; this.streakPos[p + 4] = y + 0.25; this.streakPos[p + 5] = z + 0.18;
    this.streakSpeed[i] = 11 + this.random() * 10;
  }
  private clearFootprints(): void {
    this.dummy.position.set(0, -100, 0); this.dummy.scale.setScalar(0); this.dummy.updateMatrix();
    for (let i = 0; i < FOOTPRINT_POOL; i++) this.footprints.setMatrixAt(i, this.dummy.matrix);
    this.footprints.instanceMatrix.needsUpdate = true;
  }
  reset(): void {
    this.sprayLife.fill(0); this.sprayPos.fill(-100); this.sprayGeo.getAttribute("position").needsUpdate = true;
    this.rewardLife.fill(0); this.rewardPos.fill(-100); this.rewardGeo.getAttribute("position").needsUpdate = true;
    this.scanLife = 0; (this.scanRing.material as THREE.MeshBasicMaterial).opacity = 0; this.clearFootprints(); this.footprintCursor = 0; this.footprintTotal = 0; this.footprintAges.fill(0); this.activeFootprints = 0; this.footprints.visible = false;
  }
  spray(x: number, y: number, z: number, dirX: number, dirZ: number): void {
    const count = this.lowQuality ? 2 : 4;
    for (let n = 0; n < count; n++) {
      const i = this.sprayCursor; this.sprayCursor = (this.sprayCursor + 1) % QUALITY.SPRAY_POOL;
      this.sprayPos[i * 3] = x + (this.random() - 0.5) * 0.5; this.sprayPos[i * 3 + 1] = y + this.random() * 0.3; this.sprayPos[i * 3 + 2] = z + (this.random() - 0.5) * 0.5;
      this.sprayVel[i * 3] = dirX * (1 + this.random() * 2) + (this.random() - 0.5) * 1.8;
      this.sprayVel[i * 3 + 1] = 1.2 + this.random() * 2.2;
      this.sprayVel[i * 3 + 2] = dirZ * (1 + this.random() * 2) + (this.random() - 0.5) * 1.8;
      this.sprayLife[i] = 0.45 + this.random() * 0.35;
    }
  }
  footprint(x: number, y: number, z: number, yaw: number, side: number): void {
    const i = this.footprintCursor; this.footprintCursor = (this.footprintCursor + 1) % FOOTPRINT_POOL; this.footprintTotal++;
    this.dummy.position.set(x + Math.cos(yaw) * side * 0.18, y + 0.018, z - Math.sin(yaw) * side * 0.18);
    this.dummy.rotation.set(0, yaw, 0); this.dummy.scale.set(0.13, 1, 0.28); this.dummy.updateMatrix();
    this.footprints.setMatrixAt(i, this.dummy.matrix); this.footprints.instanceMatrix.needsUpdate = true; this.footprintAges[i] = 12;
  }
  burst(x: number, y: number, z: number, color: number = COLORS.warm, amount = 24): void {
    this.color.setHex(color);
    const count = this.lowQuality ? Math.ceil(amount * 0.55) : amount;
    for (let n = 0; n < count; n++) {
      const i = this.rewardCursor; this.rewardCursor = (this.rewardCursor + 1) % REWARD_POOL;
      const a = this.random() * Math.PI * 2, speed = 1.4 + this.random() * 3.6;
      this.rewardPos[i * 3] = x; this.rewardPos[i * 3 + 1] = y; this.rewardPos[i * 3 + 2] = z;
      this.rewardVel[i * 3] = Math.sin(a) * speed; this.rewardVel[i * 3 + 1] = 2.4 + this.random() * 3.6; this.rewardVel[i * 3 + 2] = Math.cos(a) * speed;
      this.rewardColor[i * 3] = this.color.r; this.rewardColor[i * 3 + 1] = this.color.g; this.rewardColor[i * 3 + 2] = this.color.b;
      this.rewardLife[i] = 0.75 + this.random() * 0.65;
    }
    this.rewardGeo.getAttribute("color").needsUpdate = true;
  }
  scan(x: number, z: number, y = 0.8): void { this.scanLife = 1; this.scanRing.position.set(x, y, z); this.scanRing.scale.setScalar(0.2); }
  update(dt: number, storm: number, clearing: boolean, centerX = 0, centerZ = 0): void {
    this.activeFootprints = 0;
    for (let i = 0; i < FOOTPRINT_POOL; i++) {
      if (this.footprintAges[i] <= 0) continue;
      this.footprintAges[i] = Math.max(0, this.footprintAges[i] - dt);
      this.footprints.getMatrixAt(i, this.footprintMatrix); this.footprintMatrix.decompose(this.dummy.position, this.dummy.quaternion, this.dummy.scale);
      const fade = Math.min(1, this.footprintAges[i] / 3);
      if (this.footprintAges[i] <= 0) this.dummy.scale.setScalar(0);
      else { this.dummy.scale.x = 0.13 * fade; this.dummy.scale.z = 0.28 * fade; this.activeFootprints++; }
      this.dummy.updateMatrix(); this.footprints.setMatrixAt(i, this.dummy.matrix);
    }
    this.footprints.instanceMatrix.needsUpdate = true; this.footprints.visible = this.activeFootprints > 0;
    this.stormAmount = storm;
    this.snowPoints.position.set(centerX, 0, centerZ); this.streakLines.position.set(centerX, 0, centerZ);
    const flakes = this.lowQuality ? QUALITY.PARTICLES_LOW : QUALITY.PARTICLES_HIGH;
    this.snowGeo.setDrawRange(0, flakes); this.snowMat.opacity = 0.34 + storm * 0.5; this.snowMat.size = 0.09 + storm * 0.08;
    for (let i = 0; i < flakes; i++) {
      this.snowPos[i * 3] += dt * (0.35 + storm * 12); this.snowPos[i * 3 + 1] -= this.snowSpeed[i] * dt * (1 + storm * 1.5);
      this.snowPos[i * 3 + 2] -= dt * storm * 2.2;
      if (this.snowPos[i * 3 + 1] < 0 || this.snowPos[i * 3] > 34) this.resetFlake(i);
    }
    this.snowGeo.getAttribute("position").needsUpdate = true;
    const streaks = this.lowQuality ? 70 : STREAK_POOL; this.streakGeo.setDrawRange(0, streaks * 2);
    this.streakLines.visible = this.particlesEnabled && storm > 0.06; this.streakMat.opacity = storm * 0.5;
    if (this.streakLines.visible) {
      for (let i = 0; i < streaks; i++) {
        const p = i * 6, dx = this.streakSpeed[i] * dt * storm, dy = this.streakSpeed[i] * 0.24 * dt * storm;
        this.streakPos[p] += dx; this.streakPos[p + 3] += dx; this.streakPos[p + 1] -= dy; this.streakPos[p + 4] -= dy;
        if (this.streakPos[p] > 25 || this.streakPos[p + 1] < 0) this.resetStreak(i);
      }
      this.streakGeo.getAttribute("position").needsUpdate = true;
    }
    for (let i = 0; i < QUALITY.SPRAY_POOL; i++) {
      if (this.sprayLife[i] <= 0) continue; this.sprayLife[i] -= dt;
      if (this.sprayLife[i] <= 0) { this.sprayPos[i * 3 + 1] = -100; continue; }
      this.sprayVel[i * 3 + 1] -= 6 * dt;
      this.sprayPos[i * 3] += this.sprayVel[i * 3] * dt; this.sprayPos[i * 3 + 1] += this.sprayVel[i * 3 + 1] * dt; this.sprayPos[i * 3 + 2] += this.sprayVel[i * 3 + 2] * dt;
    }
    this.sprayGeo.getAttribute("position").needsUpdate = true;
    for (let i = 0; i < REWARD_POOL; i++) {
      if (this.rewardLife[i] <= 0) continue; this.rewardLife[i] -= dt;
      if (this.rewardLife[i] <= 0) { this.rewardPos[i * 3 + 1] = -100; continue; }
      this.rewardVel[i * 3 + 1] -= 7 * dt;
      this.rewardPos[i * 3] += this.rewardVel[i * 3] * dt; this.rewardPos[i * 3 + 1] += this.rewardVel[i * 3 + 1] * dt; this.rewardPos[i * 3 + 2] += this.rewardVel[i * 3 + 2] * dt;
    }
    this.rewardGeo.getAttribute("position").needsUpdate = true;
    if (this.scanLife > 0) {
      this.scanLife = Math.max(0, this.scanLife - dt * 0.55); const progress = 1 - this.scanLife;
      this.scanRing.scale.setScalar(0.2 + progress * 19); (this.scanRing.material as THREE.MeshBasicMaterial).opacity = this.scanLife * 0.65;
    }
    const mat = this.targetRing.material as THREE.MeshBasicMaterial; mat.opacity = clearing ? 0.72 : 0.26;
  }
  setParticles(enabled: boolean): void {
    this.particlesEnabled = enabled; this.snowPoints.visible = enabled; this.sprayPoints.visible = enabled;
    this.streakLines.visible = enabled && this.stormAmount > 0.06;
  }
  dispose(): void {
    for (const o of [this.snowPoints, this.sprayPoints, this.scanRing, this.targetRing, this.streakLines, this.footprints, this.rewardPoints]) { this.scene.remove(o); o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
  }
}
