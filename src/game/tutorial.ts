import { storage } from "./storage";

export interface TutorialStep { id: string; target: string; title: string; copy: string }
/** Add future HUD steps here without touching quests or tutorial navigation. */
export const INTERFACE_TUTORIAL_VERSION = 1;
export const INTERFACE_TUTORIAL_STEPS: readonly TutorialStep[] = [
  { id: "survival", target: ".resource-card", title: "tutorial.survival.title", copy: "tutorial.survival.copy" },
  { id: "quest", target: ".quest-card", title: "tutorial.quest.title", copy: "tutorial.quest.copy" },
  { id: "tools", target: ".tool-chip", title: "tutorial.tools.title", copy: "tutorial.tools.copy" },
  { id: "scanner", target: "#scanner-chip", title: "tutorial.scanner.title", copy: "tutorial.scanner.copy" },
  { id: "construction", target: "#build-dock", title: "tutorial.construction.title", copy: "tutorial.construction.copy" },
  { id: "controls", target: "auto-controls", title: "tutorial.controls.title", copy: "tutorial.controls.copy" },
  { id: "robots", target: "#robots-btn", title: "tutorial.robots.title", copy: "tutorial.robots.copy" },
];
const STORAGE_KEY = "interface-tutorial.v1";

export class InterfaceTutorial {
  active = false; index = 0;
  private root: HTMLDivElement; private spotlight: HTMLElement; private card: HTMLElement;
  private focused: Element | null = null;
  constructor(private overlay: HTMLElement, private translate: (key: string) => string, private sfx: () => void) {
    this.root = document.createElement("div"); this.root.id = "interface-tutorial"; this.root.className = "interface-tutorial hidden";
    this.root.innerHTML = `<div class="tutorial-spotlight"></div><section class="tutorial-card glass" role="dialog" aria-modal="true"><div class="tutorial-top"><span id="tutorial-count"></span><button id="tutorial-skip"></button></div><h3 id="tutorial-title"></h3><p id="tutorial-copy"></p><div class="tutorial-actions"><button id="tutorial-back" class="secondary-btn"></button><button id="tutorial-next" class="primary-btn"></button></div></section>`;
    overlay.appendChild(this.root); this.spotlight = this.root.querySelector(".tutorial-spotlight")!; this.card = this.root.querySelector(".tutorial-card")!;
    this.root.querySelector<HTMLButtonElement>("#tutorial-next")!.onclick = () => this.next();
    this.root.querySelector<HTMLButtonElement>("#tutorial-back")!.onclick = () => this.back();
    this.root.querySelector<HTMLButtonElement>("#tutorial-skip")!.onclick = () => this.skip();
  }
  shouldAutoStart(): boolean {
    const saved = storage.get<{ version?: number; complete?: boolean }>(STORAGE_KEY, {});
    return !(saved.complete && saved.version === INTERFACE_TUTORIAL_VERSION);
  }
  start(index = 0): void {
    this.active = true; this.index = Math.max(0, Math.min(INTERFACE_TUTORIAL_STEPS.length - 1, index));
    this.root.classList.remove("hidden"); this.overlay.classList.add("tutorial-active"); this.showStep();
  }
  next(): void { if (!this.active) return; this.sfx(); if (this.index >= INTERFACE_TUTORIAL_STEPS.length - 1) this.finish(); else { this.index++; this.showStep(); } }
  back(): void { if (!this.active || this.index <= 0) return; this.sfx(); this.index--; this.showStep(); }
  skip(): void { if (this.active) this.finish(); }
  private finish(): void {
    this.active = false; this.root.classList.add("hidden"); this.overlay.classList.remove("tutorial-active");
    this.focused?.classList.remove("tutorial-focus"); this.focused = null;
    storage.set(STORAGE_KEY, { version: INTERFACE_TUTORIAL_VERSION, complete: true });
  }
  private target(step: TutorialStep): Element | null {
    const selector = step.target === "auto-controls"
      ? matchMedia("(pointer: coarse)").matches || innerWidth < 760 ? "#touch-controls" : "#desktop-help"
      : step.target;
    return document.querySelector(selector);
  }
  private showStep(): void {
    const step = INTERFACE_TUTORIAL_STEPS[this.index];
    this.focused?.classList.remove("tutorial-focus"); this.focused = this.target(step); this.focused?.classList.add("tutorial-focus");
    this.root.querySelector("#tutorial-count")!.textContent = `${this.index + 1} / ${INTERFACE_TUTORIAL_STEPS.length}`;
    this.root.querySelector("#tutorial-title")!.textContent = this.translate(step.title);
    this.root.querySelector("#tutorial-copy")!.textContent = this.translate(step.copy);
    this.root.querySelector<HTMLButtonElement>("#tutorial-skip")!.textContent = this.translate("tutorial.skip");
    this.root.querySelector<HTMLButtonElement>("#tutorial-back")!.textContent = this.translate("tutorial.back");
    this.root.querySelector<HTMLButtonElement>("#tutorial-back")!.disabled = this.index === 0;
    this.root.querySelector<HTMLButtonElement>("#tutorial-next")!.textContent = this.translate(this.index === INTERFACE_TUTORIAL_STEPS.length - 1 ? "tutorial.done" : "tutorial.next");
    this.updateFrame();
  }
  updateFrame(): void {
    if (!this.active) return;
    const step = INTERFACE_TUTORIAL_STEPS[this.index]; const rect = this.focused?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      this.spotlight.classList.remove("hidden"); const pad = 7;
      this.spotlight.style.left = `${rect.left - pad}px`; this.spotlight.style.top = `${rect.top - pad}px`;
      this.spotlight.style.width = `${rect.width + pad * 2}px`; this.spotlight.style.height = `${rect.height + pad * 2}px`;
    } else this.spotlight.classList.add("hidden");
    const cardWidth = Math.min(390, innerWidth - 24); this.card.style.width = `${cardWidth}px`;
    let left = rect ? rect.left : innerWidth / 2 - cardWidth / 2;
    left = Math.max(12, Math.min(innerWidth - cardWidth - 12, left));
    let top = rect ? rect.bottom + 16 : innerHeight / 2 - 100;
    const cardHeight = this.card.offsetHeight || 210;
    if (top + cardHeight > innerHeight - 12) top = rect ? rect.top - cardHeight - 16 : innerHeight - cardHeight - 12;
    this.card.style.left = `${left}px`; this.card.style.top = `${Math.max(12, top)}px`;
    this.root.dataset.step = step.id;
  }
  view(): { active: boolean; step: number; total: number; id: string | null } {
    return { active: this.active, step: this.index, total: INTERFACE_TUTORIAL_STEPS.length, id: this.active ? INTERFACE_TUTORIAL_STEPS[this.index].id : null };
  }
  dispose(): void { this.focused?.classList.remove("tutorial-focus"); this.root.remove(); }
}
