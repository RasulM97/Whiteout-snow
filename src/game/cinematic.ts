import * as THREE from "three";
import type { SfxId } from "./audio";
import { groundHeight } from "./snow";

interface CinematicOptions {
  overlay: HTMLElement;
  scene: THREE.Scene;
  ship: THREE.Object3D;
  player: THREE.Group;
  translate: (key: string) => string;
  sfx: (id: SfxId) => void;
  onFinished: () => void;
  snowHeight: (x: number, z: number) => number;
  animate: (dt: number, moving: boolean) => void;
}

/** A short in-engine landing shot: real models, local sound and live subtitles. */
export class OpeningCinematic {
  readonly duration = 12;
  readonly cameraPosition = new THREE.Vector3();
  readonly cameraTarget = new THREE.Vector3();
  active = false; time = 0;
  private root: HTMLDivElement;
  private subtitle: HTMLElement;
  private progress: HTMLElement;
  private landed = false;
  private basePosition: THREE.Vector3;
  private baseRotation: THREE.Euler;
  private dust: THREE.Mesh;

  constructor(private options: CinematicOptions) {
    this.basePosition = options.ship.position.clone(); this.baseRotation = options.ship.rotation.clone();
    this.root = document.createElement("div"); this.root.id = "opening-cinematic"; this.root.className = "opening-cinematic hidden";
    this.root.innerHTML = `<div class="cinematic-letterbox top"></div><div class="cinematic-letterbox bottom"></div><div class="cinematic-caption glass"><div class="cinematic-kicker"></div><p id="cinematic-subtitle" aria-live="polite"></p><div class="cinematic-progress"><i></i></div></div><button id="skip-cinematic" class="cinematic-skip"></button>`;
    options.overlay.appendChild(this.root);
    this.subtitle = this.root.querySelector("#cinematic-subtitle")!;
    this.progress = this.root.querySelector(".cinematic-progress i")!;
    this.root.querySelector<HTMLButtonElement>("#skip-cinematic")!.onclick = () => this.skip();
    this.dust = new THREE.Mesh(new THREE.RingGeometry(2.5, 3.1, 48), new THREE.MeshBasicMaterial({ color: 0xc7f4f1, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.dust.rotation.x = -Math.PI / 2; this.dust.position.set(0, groundHeight(0, 15) + 0.18, 15); this.dust.visible = false; options.scene.add(this.dust);
  }

  start(): void {
    this.active = true; this.time = 0; this.landed = false;
    this.options.ship.position.copy(this.basePosition); this.options.ship.rotation.copy(this.baseRotation);
    this.options.player.visible = false; this.root.classList.remove("hidden"); this.options.overlay.classList.add("cinematic-active");
    this.options.sfx("rail"); this.update(0);
  }
  skip(): void { if (this.active) this.finish(); }
  private finish(): void {
    this.active = false; this.options.ship.position.copy(this.basePosition); this.options.ship.rotation.copy(this.baseRotation);
    this.options.player.visible = true; this.dust.visible = false; this.root.classList.add("hidden"); this.options.overlay.classList.remove("cinematic-active");
    this.options.onFinished();
  }
  update(dt: number): void {
    if (!this.active) return;
    this.time = Math.min(this.duration, this.time + dt); const t = this.time;
    const descent = THREE.MathUtils.smootherstep(t, 0.2, 5.4);
    this.options.ship.position.set(
      THREE.MathUtils.lerp(-10, this.basePosition.x, descent),
      THREE.MathUtils.lerp(17, this.basePosition.y, descent),
      THREE.MathUtils.lerp(-3, this.basePosition.z, descent),
    );
    this.options.ship.rotation.z = Math.sin(t * 1.8) * 0.06 * (1 - descent);
    if (t >= 4.6 && !this.landed) { this.landed = true; this.options.sfx("landing"); }
    const dustPhase = THREE.MathUtils.clamp((t - 3.8) / 2.2, 0, 1);
    this.dust.visible = t >= 3.8 && t < 7;
    this.dust.scale.setScalar(0.5 + dustPhase * 2.2); (this.dust.material as THREE.MeshBasicMaterial).opacity = (1 - dustPhase) * 0.35;
    if (t >= 6.4) {
      const walk = THREE.MathUtils.smootherstep(t, 6.4, 10.2); const z = THREE.MathUtils.lerp(8, 2, walk);
      this.options.player.visible = true; this.options.player.position.set(0, this.options.snowHeight(0, z), z); this.options.player.rotation.y = Math.PI;
      this.options.animate(dt, t < 10.2);
    }
    if (t < 4.8) {
      this.cameraPosition.set(15 - t * 0.7, 8.5, -7 + t * 0.5); this.cameraTarget.set(0, 5.5, 10);
    } else if (t < 8.6) {
      this.cameraPosition.set(11, 5.4, 0); this.cameraTarget.set(0, 2.1, 11);
    } else {
      const wide = (t - 8.6) / 3.4; this.cameraPosition.set(11 + wide * 8, 5.4 + wide * 12, -wide * 12); this.cameraTarget.set(0, 1.8, 7);
    }
    const cue = t < 3.7 ? 1 : t < 6.8 ? 2 : t < 9.8 ? 3 : 4;
    this.root.querySelector(".cinematic-kicker")!.textContent = this.options.translate("cinematic.kicker");
    this.subtitle.textContent = this.options.translate(`cinematic.${cue}`);
    this.progress.style.width = `${t / this.duration * 100}%`;
    this.root.querySelector<HTMLButtonElement>("#skip-cinematic")!.textContent = this.options.translate("cinematic.skip");
    if (t >= this.duration) this.finish();
  }
  dispose(): void {
    this.root.remove(); this.dust.geometry.dispose(); (this.dust.material as THREE.Material).dispose(); this.options.scene.remove(this.dust);
  }
}
