import * as THREE from "three";
import type { PlayerRig } from "./world";
import type { ToolId } from "./types";

type CharacterState = "idle" | "walk" | "run" | "work" | "pickup";
const BODY_BASE_Y = 0.23;
const damp = (current: number, target: number, speed: number, dt: number) => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-speed * dt));

/** Joint animation for the original-proportioned semi-mechanical recovery robot. */
export class CharacterAnimator {
  private time = 0;
  private stride = 0;
  private pickupTime = 0;
  private blowerOn = 0;
  private blowerWork = 0;
  private vacuumWork = 0;
  private currentState: CharacterState = "idle";
  ready = true;

  constructor(private player: PlayerRig) {}

  pickup(): void { this.pickupTime = 0.72; }

  update(dt: number, moving: boolean, working: boolean, tool: ToolId = "hands", interacting = false, sprinting = false): void {
    this.time += dt;
    if (interacting && this.pickupTime <= 0.05) this.pickupTime = 0.72;
    this.pickupTime = Math.max(0, this.pickupTime - dt);
    this.currentState = this.pickupTime > 0 ? "pickup" : working ? "work" : moving ? sprinting ? "run" : "walk" : "idle";
    if (moving) this.stride += dt * (sprinting ? 13.4 : 9.2);
    const walk = moving ? 1 : 0;
    const run = moving && sprinting ? 1 : 0;
    const phase = Math.sin(this.stride);
    const opposite = Math.sin(this.stride + Math.PI);
    const lift = Math.abs(Math.cos(this.stride));
    const workWave = Math.sin(this.time * (tool === "hands" ? 8 : tool === "shovel" ? 7 : 11));
    const pickup = this.pickupTime > 0 ? Math.sin((1 - this.pickupTime / 0.72) * Math.PI) : 0;
    const holding = tool !== "hands";
    const shovel = tool === "shovel";
    const wideTool = tool === "brush" || tool === "blower" || tool === "vacuum";

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const legPhase = i === 0 ? phase : opposite;
      const armPhase = i === 0 ? opposite : phase;
      const legTarget = walk * legPhase * (0.64 + run * 0.18);
      this.player.legs[i].rotation.x = damp(this.player.legs[i].rotation.x, legTarget, 18, dt);
      this.player.legs[i].rotation.z = damp(this.player.legs[i].rotation.z, side * 0.025, 12, dt);
      const kneeTarget = 0.045 + walk * Math.max(0, -legPhase) * 0.92;
      this.player.knees[i].rotation.x = damp(this.player.knees[i].rotation.x, kneeTarget, 20, dt);

      // Tools mount to the chest yoke; the arms stabilize that mount rather than fake a grip.
      let armX = holding ? (i === 0 ? -0.54 : -0.62) : -0.24;
      let elbowX = holding ? (wideTool ? -0.38 : -0.32) : -0.2;
      armX += walk * armPhase * (holding ? 0.09 : 0.4);
      if (working) {
        armX = holding ? (i === 0 ? -0.58 : -0.64) + workWave * (shovel ? 0.13 : 0.055) : -0.72 + workWave * 0.22 * side;
        elbowX = holding ? -0.36 + workWave * 0.09 : -0.48 - Math.max(0, workWave * side) * 0.28;
      }
      if (pickup > 0) {
        armX = THREE.MathUtils.lerp(armX, -1.08, pickup);
        elbowX = THREE.MathUtils.lerp(elbowX, -0.22, pickup);
      }
      this.player.arms[i].rotation.x = damp(this.player.arms[i].rotation.x, armX, 20, dt);
      this.player.arms[i].rotation.z = damp(this.player.arms[i].rotation.z, side * (holding ? 0.12 : 0.07), 16, dt);
      this.player.elbows[i].rotation.x = damp(this.player.elbows[i].rotation.x, elbowX, 20, dt);
    }

    const bob = walk * lift * (0.065 + run * 0.025) + (1 - walk) * Math.sin(this.time * 1.8) * 0.012;
    // Preserve the rig's boot-sole offset; animation only adds motion around it.
    this.player.body.position.y = damp(this.player.body.position.y, BODY_BASE_Y + bob - pickup * 0.12, 18, dt);
    this.player.torso.rotation.x = damp(this.player.torso.rotation.x, 0.035 + walk * 0.055 + run * 0.11 + (working ? 0.12 + Math.abs(workWave) * 0.055 : 0) + pickup * 0.5, 14, dt);
    this.player.torso.rotation.z = damp(this.player.torso.rotation.z, walk * phase * 0.045, 14, dt);
    this.player.head.rotation.x = damp(this.player.head.rotation.x, working ? 0.12 : pickup * 0.32, 12, dt);
    this.player.head.rotation.y = Math.sin(this.time * 0.75) * (moving || working ? 0.018 : 0.065);
    this.player.head.rotation.z = damp(this.player.head.rotation.z, -walk * phase * 0.025, 12, dt);

    const nozzle = this.player.nozzle;
    const targetPitch = working ? (shovel ? -0.3 + workWave * 0.28 : tool === "brush" ? workWave * 0.11 : -0.08) : holding ? -0.08 : 0;
    nozzle.rotation.x = damp(nozzle.rotation.x, targetPitch - pickup * 0.4, 20, dt);
    nozzle.rotation.y = damp(nozzle.rotation.y, working && tool === "brush" ? workWave * 0.16 : 0, 18, dt);
    nozzle.rotation.z = damp(nozzle.rotation.z, 0, 20, dt);
    nozzle.position.y = damp(nozzle.position.y, 1.18 - pickup * 0.24, 18, dt);
    this.animateClearingTools(dt, tool, working);
  }

  /** Blower sweeps and vibrates on its own mount. Vacuum pulls back along that mount and recovers. */
  private animateClearingTools(dt: number, tool: ToolId, working: boolean): void {
    this.blowerOn = damp(this.blowerOn, tool === "blower" ? 1 : 0, 8, dt);
    this.blowerWork = damp(this.blowerWork, tool === "blower" && working ? 1 : 0, 8, dt);
    this.vacuumWork = damp(this.vacuumWork, tool === "vacuum" && working ? 1 : 0, 8, dt);
    const blower = this.player.tools.blower;
    const vacuum = this.player.tools.vacuum;
    const vibe = this.blowerOn * (0.0032 + this.blowerWork * 0.0065);
    blower.rotation.x = damp(blower.rotation.x, 0, 14, dt);
    blower.rotation.y = damp(blower.rotation.y, Math.sin(this.time * 4.6) * 0.38 * this.blowerWork, 12, dt);
    blower.rotation.z = damp(blower.rotation.z, 0, 14, dt);
    blower.position.x = Math.sin(this.time * 46) * vibe;
    blower.position.y = Math.sin(this.time * 61) * vibe * 0.6;
    blower.position.z = damp(blower.position.z, 0, 14, dt);
    const pull = (0.5 - 0.5 * Math.cos(this.time * 6.2)) * this.vacuumWork;
    vacuum.rotation.x = damp(vacuum.rotation.x, 0.26 * pull, 10, dt);
    vacuum.rotation.y = damp(vacuum.rotation.y, 0, 14, dt);
    vacuum.rotation.z = damp(vacuum.rotation.z, 0, 14, dt);
    vacuum.position.x = damp(vacuum.position.x, 0, 14, dt);
    vacuum.position.y = damp(vacuum.position.y, 0, 14, dt);
    vacuum.position.z = damp(vacuum.position.z, -0.14 * pull, 10, dt);
  }

  state(): CharacterState { return this.currentState; }
  dispose(): void { this.pickupTime = 0; this.blowerOn = 0; this.blowerWork = 0; this.vacuumWork = 0; }
}
