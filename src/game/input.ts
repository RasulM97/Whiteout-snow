const KEYMAP: Record<string, ["moveX" | "moveZ", 1 | -1]> = {
  KeyW: ["moveZ", 1], ArrowUp: ["moveZ", 1], KeyS: ["moveZ", -1], ArrowDown: ["moveZ", -1],
  KeyA: ["moveX", -1], ArrowLeft: ["moveX", -1], KeyD: ["moveX", 1], ArrowRight: ["moveX", 1],
};
export interface PointerClick { x: number; y: number; button: number }

export class Input {
  moveX = 0; moveZ = 0; pointerX = 0; pointerY = 0; pointerActive = false;
  readonly isCoarse = matchMedia("(pointer: coarse)").matches || window.innerWidth < 760;
  readonly actions = new Set<string>();
  private held = new Set<string>(); private mouseClear = false; private touchClear = false;
  private unsubscribe: Array<() => void> = []; private stickPointer: number | null = null;
  private clicks: PointerClick[] = [];
  private orbitPointer: number | null = null; private orbitLastX = 0;
  mode: "play" | "build" = "play"; cameraRotate = false;
  zoomDelta = 0; orbitDelta = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const on = <T extends Event>(el: Window | Document | HTMLElement, type: string, fn: (e: T) => void, opts?: AddEventListenerOptions) => {
      const handler = fn as EventListener; el.addEventListener(type, handler, opts); this.unsubscribe.push(() => el.removeEventListener(type, handler, opts));
    };
    on<KeyboardEvent>(window, "keydown", (e) => {
      // Focused buttons own Enter/Space. Let the browser emit exactly one click
      // instead of also feeding the same key into the global game actions.
      if (e.target instanceof HTMLSelectElement) return;
      const button = e.target instanceof HTMLButtonElement ? e.target : null;
      if (button && !button.disabled && button.getClientRects().length > 0 && getComputedStyle(button).visibility !== "hidden" && (e.code === "Space" || e.code === "Enter")) return;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
      if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const mapped = KEYMAP[e.code]; if (mapped) this.held.add(e.code);
      if (["Space", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight"].includes(e.code)) this.held.add(e.code);
      this.actions.add(e.code); this.recomputeAxes();
    });
    on<KeyboardEvent>(window, "keyup", (e) => { this.held.delete(e.code); this.recomputeAxes(); });
    on(window, "blur", () => this.resetAll()); on(document, "visibilitychange", () => { if (document.hidden) this.resetAll(); });
    on<PointerEvent>(canvas, "pointermove", (e) => {
      if (this.orbitPointer === e.pointerId) { this.orbitDelta += (e.clientX - this.orbitLastX) * 0.008; this.orbitLastX = e.clientX; e.preventDefault(); return; }
      if (e.pointerType === "touch" && this.mode === "play") return;
      this.setPointer(e); this.pointerActive = true;
    });
    on<PointerEvent>(canvas, "pointerdown", (e) => {
      if (this.cameraRotate && (e.button === 2 || (e.pointerType === "touch" && !e.isPrimary))) {
        this.orbitPointer = e.pointerId; this.orbitLastX = e.clientX; canvas.setPointerCapture(e.pointerId); e.preventDefault(); return;
      }
      this.setPointer(e); this.pointerActive = true;
      if (this.mode === "build" || e.button === 2) this.clicks.push({ x: this.pointerX, y: this.pointerY, button: e.button });
      else if (e.pointerType !== "touch" && e.button === 0) this.mouseClear = true;
    });
    const endOrbit = (e: PointerEvent) => { if (this.orbitPointer === e.pointerId) this.orbitPointer = null; };
    on<PointerEvent>(window, "pointerup", (e) => { if (e.button === 0) this.mouseClear = false; endOrbit(e); });
    on<PointerEvent>(window, "pointercancel", endOrbit);
    on(canvas, "pointerleave", () => { this.pointerActive = false; this.mouseClear = false; });
    on(canvas, "contextmenu", (e) => e.preventDefault());
    on<WheelEvent>(canvas, "wheel", (e) => { e.preventDefault(); this.zoomDelta += Math.sign(e.deltaY); }, { passive: false });
    this.bindTouchControls(on);
  }

  private setPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private bindTouchControls(on: <T extends Event>(el: Window | Document | HTMLElement, type: string, fn: (e: T) => void, opts?: AddEventListenerOptions) => void): void {
    const stick = document.getElementById("move-stick"); const knob = document.getElementById("move-knob");
    if (stick && knob) {
      const move = (e: PointerEvent) => {
        if (this.stickPointer !== e.pointerId) return;
        const r = stick.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2); let dy = e.clientY - (r.top + r.height / 2);
        const max = r.width * 0.32; const len = Math.hypot(dx, dy); if (len > max) { dx *= max / len; dy *= max / len; }
        this.moveX = dx / max; this.moveZ = -dy / max; knob.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      on<PointerEvent>(stick, "pointerdown", (e) => { e.preventDefault(); this.stickPointer = e.pointerId; stick.setPointerCapture(e.pointerId); move(e); });
      on<PointerEvent>(stick, "pointermove", move);
      const end = (e: PointerEvent) => { if (this.stickPointer !== e.pointerId) return; this.stickPointer = null; this.moveX = 0; this.moveZ = 0; knob.style.transform = "translate(0px, 0px)"; };
      on<PointerEvent>(stick, "pointerup", end); on<PointerEvent>(stick, "pointercancel", end);
    }
    const clear = document.getElementById("touch-clear");
    if (clear) {
      on<PointerEvent>(clear, "pointerdown", (e) => { e.preventDefault(); clear.setPointerCapture(e.pointerId); this.touchClear = true; clear.classList.add("pressed"); });
      const end = () => { this.touchClear = false; clear.classList.remove("pressed"); };
      on<PointerEvent>(clear, "pointerup", end); on<PointerEvent>(clear, "pointercancel", end);
    }
  }

  get clearHeld(): boolean { return this.mode === "play" && (this.mouseClear || this.touchClear || this.held.has("Space")); }
  get sprintHeld(): boolean { return this.mode === "play" && (this.held.has("ShiftLeft") || this.held.has("ShiftRight") || this.stickPointer !== null && Math.hypot(this.moveX, this.moveZ) > 0.92); }
  get pointerClearing(): boolean { return this.mode === "play" && this.mouseClear; }
  get detailsHeld(): boolean { return this.held.has("ControlLeft") || this.held.has("ControlRight"); }
  consumeAction(code: string): boolean { const has = this.actions.has(code); if (has) this.actions.delete(code); return has; }
  consumeClick(): PointerClick | undefined { return this.clicks.shift(); }
  consumeZoom(): number { const z = this.zoomDelta; this.zoomDelta = 0; return z; }
  consumeOrbit(): number { const value = this.orbitDelta; this.orbitDelta = 0; return value; }
  private recomputeAxes(): void {
    if (this.stickPointer !== null) return;
    let x = 0, z = 0;
    for (const code of this.held) { const m = KEYMAP[code]; if (m) { if (m[0] === "moveX") x += m[1]; else z += m[1]; } }
    this.moveX = Math.max(-1, Math.min(1, x)); this.moveZ = Math.max(-1, Math.min(1, z));
  }
  resetAll(): void {
    this.held.clear(); this.actions.clear(); this.mouseClear = false; this.touchClear = false; this.clicks.length = 0; this.orbitPointer = null; this.orbitDelta = 0;
    this.moveX = 0; this.moveZ = 0; this.stickPointer = null;
    const knob = document.getElementById("move-knob"); if (knob) knob.style.transform = "translate(0px, 0px)";
  }
  dispose(): void { for (const off of this.unsubscribe) off(); this.unsubscribe = []; this.resetAll(); }
}
