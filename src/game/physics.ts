import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { GAME } from "./config";
import { groundHeight, type CircleZone } from "./snow";

await RAPIER.init();

/** Rapier heightfield + kinematic capsule. Visual snow and physics share groundHeight(). */
export class PhysicsSystem {
  private world = new RAPIER.World({ x: 0, y: -18, z: 0 });
  private controller: RAPIER.KinematicCharacterController;
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private dynamicColliders: RAPIER.Collider[] = [];
  private desired = { x: 0, y: 0, z: 0 };
  private readonly footOffset = 0.86;

  constructor(obstacles: CircleZone[]) {
    const n = 160;
    const heights = new Float32Array((n + 1) * (n + 1));
    const size = GAME.worldSize + 8;
    for (let column = 0; column <= n; column++) for (let row = 0; row <= n; row++) {
      const x = (column / n - 0.5) * size;
      const z = (row / n - 0.5) * size;
      heights[column * (n + 1) + row] = groundHeight(x, z);
    }
    this.world.createCollider(RAPIER.ColliderDesc.heightfield(n, n, heights, { x: size, y: 1, z: size }));
    for (const obstacle of obstacles) this.addCircle(obstacle, false);
    const wall = GAME.worldLimit + 0.6;
    for (const [x, z, hx, hz] of [[0, -wall, wall, 0.3], [0, wall, wall, 0.3], [-wall, 0, 0.3, wall], [wall, 0, 0.3, wall]] as const) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 4, hz).setTranslation(x, 2, z));
    }
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(GAME.spawn.x, groundHeight(GAME.spawn.x, GAME.spawn.z) + this.footOffset, GAME.spawn.z));
    this.collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(0.43, 0.43).setFriction(0.2), this.body);
    this.controller = this.world.createCharacterController(0.015);
    this.controller.setMaxSlopeClimbAngle(48 * Math.PI / 180);
    this.controller.setMinSlopeSlideAngle(34 * Math.PI / 180);
    this.controller.enableAutostep(0.42, 0.18, true);
    this.controller.enableSnapToGround(0.45);
    this.controller.setSlideEnabled(true);
  }

  addCircle(obstacle: CircleZone, dynamic = true): void {
    const y = groundHeight(obstacle.x, obstacle.z) + 2.4;
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cylinder(2.5, obstacle.r).setTranslation(obstacle.x, y, obstacle.z));
    if (dynamic) this.dynamicColliders.push(collider);
  }
  clearDynamic(): void {
    for (const collider of this.dynamicColliders) this.world.removeCollider(collider, true);
    this.dynamicColliders.length = 0;
  }
  reset(x: number, z: number): void {
    this.body.setTranslation({ x, y: groundHeight(x, z) + this.footOffset + 0.08, z }, true);
  }
  move(position: THREE.Vector3, dx: number, dz: number, dt: number): void {
    let current = this.body.translation();
    if (Math.hypot(current.x - position.x, current.z - position.z) > 2) {
      this.reset(position.x, position.z); current = this.body.translation();
    }
    this.desired.x = dx; this.desired.y = -9 * dt; this.desired.z = dz;
    this.controller.computeColliderMovement(this.collider, this.desired);
    const corrected = this.controller.computedMovement();
    const x = current.x + corrected.x; const z = current.z + corrected.z;
    // The heightfield handles collision and slope motion; the shared analytic
    // surface removes sub-cell height error between physics and the visible mesh.
    const y = groundHeight(x, z) + this.footOffset;
    this.body.setNextKinematicTranslation({ x, y, z });
    this.world.step();
    position.x = this.body.translation().x;
    position.z = this.body.translation().z;
  }
  get footY(): number { const p = this.body.translation(); return groundHeight(p.x, p.z) + 0.025; }
  dispose(): void {
    this.controller.free();
    this.world.free();
    this.dynamicColliders.length = 0;
  }
}
