import * as THREE from "three";
import { COLORS } from "./config";
import type { ToolId } from "./types";
import type { ModelLibrary } from "./models";
import { mesh } from "./world";

function createToolModels(nozzle: THREE.Group, shell: THREE.Material, dark: THREE.Material, white: THREE.Material, glow: THREE.Material): Record<ToolId, THREE.Group> {
  const tools = {} as Record<ToolId, THREE.Group>;
  for (const id of ["hands", "shovel", "brush", "blower", "vacuum"] as ToolId[]) {
    tools[id] = new THREE.Group(); tools[id].name = `tool-${id}`; nozzle.add(tools[id]);
    mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.24, 10), dark, tools[id], 0, 0, 0).rotation.x = Math.PI / 2;
  }
  const hands = tools.hands;
  mesh(new THREE.BoxGeometry(0.65, 0.12, 0.62), shell, hands, 0, -0.18, 0.48);
  for (const x of [-0.32, 0.32]) {
    const claw = mesh(new THREE.BoxGeometry(0.11, 0.28, 0.68), white, hands, x, -0.05, 0.48); claw.rotation.z = x * 0.3;
  }
  for (const [x, y, z, s] of [[-0.15, 0.02, 0.5, 0.2], [0.13, 0.04, 0.57, 0.22], [0, 0.18, 0.5, 0.18]] as const) {
    mesh(new THREE.IcosahedronGeometry(s, 1), white, hands, x, y, z);
  }
  const shovel = tools.shovel;
  const shovelBoom = mesh(new THREE.CylinderGeometry(0.075, 0.09, 1.35, 10), shell, shovel, 0, 0, 0.72); shovelBoom.rotation.x = Math.PI / 2;
  mesh(new THREE.BoxGeometry(0.72, 0.14, 0.16), dark, shovel, 0, -0.05, 1.3);
  const blade = mesh(new THREE.BoxGeometry(0.72, 0.12, 0.65), white, shovel, 0, -0.2, 1.55); blade.rotation.x = -0.28;
  for (const x of [-0.29, 0.29]) mesh(new THREE.BoxGeometry(0.08, 0.26, 0.68), shell, shovel, x, -0.1, 1.54).rotation.x = -0.28;

  const brush = tools.brush;
  for (const x of [-0.38, 0.38]) {
    const support = mesh(new THREE.BoxGeometry(0.1, 0.13, 1.18), shell, brush, x, -0.04, 0.62); support.rotation.x = -0.08;
  }
  const brushSpin = new THREE.Group(); brushSpin.name = "spin"; brushSpin.position.set(0, -0.2, 1.18); brush.add(brushSpin);
  const roller = mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.45, 14), dark, brushSpin); roller.rotation.z = Math.PI / 2;
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const bristle = mesh(new THREE.BoxGeometry(1.5, 0.055, 0.12), glow, brushSpin, 0, Math.sin(a) * 0.26, Math.cos(a) * 0.26); bristle.rotation.x = a; }

  const blower = tools.blower;
  mesh(new THREE.BoxGeometry(0.58, 0.5, 0.66), shell, blower, 0, 0.04, 0.34);
  mesh(new THREE.BoxGeometry(0.42, 0.24, 0.06), glow, blower, 0, 0.12, 0.69);
  const blowerPipe = mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.25, 12), dark, blower, 0, -0.04, 1.25); blowerPipe.rotation.x = Math.PI / 2;
  const rim = mesh(new THREE.TorusGeometry(0.2, 0.055, 8, 16), glow, blower, 0, -0.04, 1.88); rim.name = "spin";
  for (const x of [-0.19, 0.19]) mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), white, blower, x, 0.39, 0.3);

  const vacuum = tools.vacuum;
  mesh(new THREE.BoxGeometry(0.66, 0.66, 0.68), white, vacuum, 0, 0.08, 0.34);
  mesh(new THREE.BoxGeometry(0.5, 0.34, 0.07), glow, vacuum, 0, 0.16, 0.7);
  for (const x of [-0.39, 0.39]) { const wheel = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 12), dark, vacuum, x, -0.24, 0.32); wheel.rotation.z = Math.PI / 2; }
  const suction = mesh(new THREE.CylinderGeometry(0.23, 0.12, 1.05, 12), dark, vacuum, 0, -0.1, 1.25); suction.rotation.x = Math.PI / 2;
  mesh(new THREE.ConeGeometry(0.4, 0.42, 12, 1, true), shell, vacuum, 0, -0.1, 1.9).rotation.x = -Math.PI / 2;
  const hose = mesh(new THREE.TorusGeometry(0.32, 0.065, 8, 20, Math.PI * 1.35), dark, vacuum, 0.25, 0.06, 0.78); hose.rotation.y = Math.PI / 2;
  for (const [id, tool] of Object.entries(tools)) tool.visible = id === "hands";
  return tools;
}

export interface PlayerRig {
  group: THREE.Group; legs: THREE.Group[]; arms: THREE.Group[]; knees: THREE.Group[]; elbows: THREE.Group[];
  torso: THREE.Group; head: THREE.Group; body: THREE.Group; nozzle: THREE.Group; visual: THREE.Group; tools: Record<ToolId, THREE.Group>;
}
export function createPlayer(): PlayerRig {
  const group = new THREE.Group(); const body = new THREE.Group(); body.position.y = 0.23; group.add(body); const visual = new THREE.Group(); body.add(visual);
  const shell = new THREE.MeshStandardMaterial({ color: COLORS.orange, roughness: 0.56, metalness: 0.16 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x19333d, roughness: 0.46, metalness: 0.42 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe5ece5, roughness: 0.4, metalness: 0.12 });
  const glow = new THREE.MeshStandardMaterial({ color: COLORS.cyan, emissive: COLORS.cyan, emissiveIntensity: 2 });
  const legs: THREE.Group[] = []; const knees: THREE.Group[] = [];
  for (const x of [-0.25, 0.25]) {
    const leg = new THREE.Group(); leg.position.set(x, 0.87, 0); visual.add(leg);
    mesh(new THREE.CapsuleGeometry(0.14, 0.25, 4, 8), dark, leg, 0, -0.22);
    const knee = new THREE.Group(); knee.position.y = -0.45; leg.add(knee);
    mesh(new THREE.SphereGeometry(0.18, 12, 8), shell, knee);
    mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.32, 10), white, knee, 0, -0.25);
    mesh(new THREE.BoxGeometry(0.4, 0.25, 0.58), dark, knee, 0, -0.48, 0.12);
    mesh(new THREE.BoxGeometry(0.42, 0.07, 0.61), white, knee, 0, -0.59, 0.13);
    for (const side of [-0.12, 0.12]) mesh(new THREE.BoxGeometry(0.055, 0.03, 0.48), shell, knee, side, -0.635, 0.13);
    legs.push(leg); knees.push(knee);
  }
  const torso = new THREE.Group(); torso.position.y = 1.24; visual.add(torso);
  mesh(new THREE.CapsuleGeometry(0.48, 0.48, 6, 14), shell, torso);
  mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.13, 16), dark, torso, 0, -0.29);
  mesh(new THREE.BoxGeometry(0.5, 0.3, 0.09), dark, torso, 0, 0.08, 0.44);
  mesh(new THREE.BoxGeometry(0.35, 0.07, 0.04), glow, torso, 0, 0.13, 0.5);
  for (const x of [-0.12, 0, 0.12]) mesh(new THREE.SphereGeometry(0.035, 8, 6), x === 0 ? white : glow, torso, x, 0.02, 0.5);
  mesh(new THREE.BoxGeometry(0.72, 0.75, 0.38), dark, torso, 0, 0.02, -0.46);
  for (const x of [-0.22, 0.22]) mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.62, 10), white, torso, x, 0.04, -0.68);
  const head = new THREE.Group(); head.position.y = 0.75; torso.add(head);
  mesh(new THREE.SphereGeometry(0.48, 22, 16), white, head);
  const face = mesh(new THREE.SphereGeometry(0.4, 20, 14), dark, head, 0, -0.02, 0.25); face.scale.set(1, 0.7, 0.48);
  for (const x of [-0.15, 0.15]) {
    const eye = mesh(new THREE.SphereGeometry(0.07, 10, 8), glow, head, x, 0.03, 0.438); eye.scale.set(1, 1.25, 0.45);
  }
  mesh(new THREE.BoxGeometry(0.14, 0.025, 0.025), glow, head, 0, -0.13, 0.45);
  for (const x of [-0.47, 0.47]) { const ear = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 12), shell, head, x, 0, 0); ear.rotation.z = Math.PI / 2; }
  mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.3, 8), dark, head, 0.2, 0.5, 0);
  mesh(new THREE.SphereGeometry(0.075, 10, 8), glow, head, 0.2, 0.67, 0);
  const arms: THREE.Group[] = []; const elbows: THREE.Group[] = [];
  for (const x of [-0.53, 0.53]) {
    const arm = new THREE.Group(); arm.position.set(x, 0.28, 0); torso.add(arm);
    mesh(new THREE.SphereGeometry(0.2, 12, 9), shell, arm);
    mesh(new THREE.CapsuleGeometry(0.12, 0.23, 4, 8), white, arm, 0, -0.23);
    const elbow = new THREE.Group(); elbow.position.y = -0.43; arm.add(elbow);
    mesh(new THREE.SphereGeometry(0.15, 12, 8), dark, elbow);
    mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 10), shell, elbow, 0, -0.2);
    const claw = mesh(new THREE.BoxGeometry(0.25, 0.2, 0.3), white, elbow, 0, -0.4, 0.06); claw.rotation.x = -0.12;
    for (const side of [-0.1, 0.1]) mesh(new THREE.BoxGeometry(0.055, 0.16, 0.22), dark, elbow, side, -0.43, 0.21);
    arms.push(arm); elbows.push(elbow);
  }
  // A visible chest yoke makes every tool part of the robot, never a floating held prop.
  const yoke = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.92, 10), dark, visual, 0, 1.18, 0.43); yoke.rotation.z = Math.PI / 2;
  for (const x of [-0.43, 0.43]) mesh(new THREE.SphereGeometry(0.13, 10, 8), shell, visual, x, 1.18, 0.43);
  const nozzle = new THREE.Group(); nozzle.position.set(0, 1.18, 0.43); body.add(nozzle);
  const tools = createToolModels(nozzle, shell, dark, white, glow);
  const shadow = mesh(new THREE.CircleGeometry(0.65, 24), new THREE.MeshBasicMaterial({ color: 0x0a2027, transparent: true, opacity: 0.3, depthWrite: false }), group, 0, 0.035); shadow.rotation.x = -Math.PI / 2; shadow.castShadow = false;
  return { group, legs, arms, knees, elbows, torso, head, body, nozzle, visual, tools };
}

export function attachEngineer(_models: ModelLibrary, _player: PlayerRig): void {
  // The original-proportioned recovery robot is fully procedural and joint driven.
}
