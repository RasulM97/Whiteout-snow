export type SfxId = "scan" | "pickup" | "deposit" | "upgrade" | "ui" | "warning" | "win" | "lose" | "empty" | "build" | "rail" | "sell" | "robot" | "repair" | "landing";
export type MusicTrack = "quiet-aurora" | "snowglass-drift" | "polar-night" | "none";
const MUTE_KEY = "whiteout.muted";
const TRACK_FILES: Record<Exclude<MusicTrack, "none">, string> = {
  "quiet-aurora": "quiet-aurora-loop.mp3", "snowglass-drift": "snowglass-drift-loop.mp3", "polar-night": "polar-night-loop.mp3",
};
const SFX_FILES: Record<SfxId, string> = {
  scan: "scanner-pulse.mp3", pickup: "success-chime.mp3", deposit: "snow-clearing-loop.mp3", upgrade: "success-chime.mp3",
  ui: "ui-tap.mp3", warning: "warning-cue.mp3", win: "success-chime.mp3", lose: "warning-cue.mp3", empty: "ui-tap.mp3",
  build: "machine-action.mp3", rail: "machine-action.mp3", sell: "success-chime.mp3", robot: "machine-action.mp3",
  repair: "robot-repair-chime.mp3", landing: "landing-soft.mp3",
};
const SFX_MIX: Record<SfxId, { volume: number; rate: number }> = {
  scan: { volume: 0.72, rate: 1 }, pickup: { volume: 0.64, rate: 1.08 }, deposit: { volume: 0.5, rate: 1.35 }, upgrade: { volume: 0.72, rate: 1 },
  ui: { volume: 0.5, rate: 1 }, warning: { volume: 0.72, rate: 1 }, win: { volume: 0.82, rate: 0.92 }, lose: { volume: 0.68, rate: 0.82 },
  empty: { volume: 0.35, rate: 0.78 }, build: { volume: 0.7, rate: 1 }, rail: { volume: 0.64, rate: 1.12 }, sell: { volume: 0.68, rate: 1.15 },
  robot: { volume: 0.58, rate: 1.12 }, repair: { volume: 0.82, rate: 1 }, landing: { volume: 0.72, rate: 1 },
};
function readMuted(): boolean { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } }
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const asset = (name: string): string => new URL(`assets/audio/${name}`, document.baseURI).href;

export class AudioSystem {
  private ctx: AudioContext | null = null; private master: GainNode | null = null;
  private ambienceBus: GainNode | null = null; private windGain: GainNode | null = null;
  private sources: AudioScheduledSourceNode[] = []; private disposed = false;
  private volume = 0.7; private stormIntensity = 0;
  private ambience = new Audio(asset("arctic-ambience.mp3")); private music = new Audio(asset(TRACK_FILES["quiet-aurora"]));
  private repair: HTMLAudioElement; private clearingAudio = new Audio(asset("snow-clearing-loop.mp3"));
  private effects = new Map<SfxId, HTMLAudioElement>();
  private musicTrack: MusicTrack = "quiet-aurora"; private musicEnabled = true; private musicVolume = 0.55;
  private sfxEnabled = true; private sfxVolume = 0.7; private ambienceEnabled = true; private ambienceVolume = 0.55;
  private emitted: Partial<Record<SfxId, number>> = {}; private clearing = false; private lastWindTarget = -1;
  muted = readMuted();
  private readonly unlock = () => { this.ensureCtx(); this.detachUnlock(); };
  constructor() {
    window.addEventListener("pointerdown", this.unlock); window.addEventListener("keydown", this.unlock);
    for (const id of Object.keys(SFX_FILES) as SfxId[]) {
      const audio = new Audio(asset(SFX_FILES[id])); audio.preload = "auto"; this.effects.set(id, audio);
    }
    this.repair = this.effects.get("repair")!;
    this.ambience.loop = true; this.music.loop = true; this.clearingAudio.loop = true;
    this.ambience.preload = "auto"; this.music.preload = "auto"; this.clearingAudio.preload = "auto";
    this.updateAmbience();
  }
  private detachUnlock(): void { window.removeEventListener("pointerdown", this.unlock); window.removeEventListener("keydown", this.unlock); }
  private effectiveVolume(): number { return this.muted ? 0 : 0.48 * this.volume; }
  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext(); this.ctx = ctx;
      this.master = ctx.createGain(); this.master.gain.value = this.effectiveVolume(); this.master.connect(ctx.destination);
      this.ambienceBus = ctx.createGain(); this.ambienceBus.connect(this.master);
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const data = buffer.getChannelData(0); let seed = 918273;
      for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; data[i] = ((seed >>> 8) / 0x800000 - 1) * 0.42; }
      const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 780;
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0.006;
      source.connect(filter).connect(this.windGain).connect(this.ambienceBus); source.start(); this.sources.push(source);
      this.updateAmbience();
      if (this.ambienceEnabled && !this.muted) void this.ambience.play().catch(() => undefined);
      if (this.musicEnabled && this.musicTrack !== "none" && !this.muted) void this.music.play().catch(() => undefined);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume(); return this.ctx;
  }
  private updateAmbience(): void {
    const audible = !this.muted && !this.disposed;
    this.ambience.volume = audible && this.ambienceEnabled ? this.volume * this.ambienceVolume * 0.26 : 0;
    const duck = 1 - Math.min(0.42, this.stormIntensity * 0.3);
    this.music.volume = audible && this.musicEnabled && this.musicTrack !== "none" ? this.volume * this.musicVolume * 0.52 * duck : 0;
    for (const [id, audio] of this.effects) audio.volume = audible && this.sfxEnabled ? Math.min(1, this.volume * this.sfxVolume * SFX_MIX[id].volume) : 0;
    this.clearingAudio.volume = audible && this.sfxEnabled && this.clearing ? Math.min(1, this.volume * this.sfxVolume * 0.55) : 0;
    if (!audible || !this.ambienceEnabled) this.ambience.pause(); else if (this.ctx) void this.ambience.play().catch(() => undefined);
    if (!audible || !this.musicEnabled || this.musicTrack === "none") this.music.pause(); else if (this.ctx) void this.music.play().catch(() => undefined);
    if (this.ambienceBus && this.ctx) this.ambienceBus.gain.setTargetAtTime(this.ambienceEnabled ? this.ambienceVolume : 0, this.ctx.currentTime, 0.08);
  }
  toggleMute(): boolean {
    this.muted = !this.muted; try { localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0"); } catch { /* session-only */ }
    if (this.master) this.master.gain.setTargetAtTime(this.effectiveVolume(), this.ctx!.currentTime, 0.03); this.updateAmbience(); return this.muted;
  }
  setVolume(value: number): void { this.volume = clamp(value); if (this.master) this.master.gain.setTargetAtTime(this.effectiveVolume(), this.ctx!.currentTime, 0.03); this.updateAmbience(); }
  setMusicTrack(track: MusicTrack): void {
    if (track === this.musicTrack) return; this.musicTrack = track; this.music.pause();
    if (track !== "none") { this.music.src = asset(TRACK_FILES[track]); this.music.loop = true; this.music.load(); }
    this.updateAmbience();
  }
  setMusicEnabled(enabled: boolean): void { this.musicEnabled = enabled; this.updateAmbience(); }
  setMusicVolume(value: number): void { this.musicVolume = clamp(value); this.updateAmbience(); }
  setSfxEnabled(enabled: boolean): void { this.sfxEnabled = enabled; this.updateAmbience(); }
  setSfxVolume(value: number): void { this.sfxVolume = clamp(value); this.updateAmbience(); }
  setAmbienceEnabled(enabled: boolean): void { this.ambienceEnabled = enabled; this.updateAmbience(); }
  setAmbienceVolume(value: number): void { this.ambienceVolume = clamp(value); this.updateAmbience(); }
  setClearing(active: boolean): void {
    if (active === this.clearing) return; this.clearing = active; this.updateAmbience();
    if (active && !this.muted && this.sfxEnabled) void this.clearingAudio.play().catch(() => undefined);
    else { this.clearingAudio.pause(); this.clearingAudio.currentTime = 0; }
  }
  setStorm(intensity: number): void {
    if (Math.abs(intensity - this.stormIntensity) < 0.005) return;
    this.stormIntensity = Math.max(0, intensity);
    const target = this.muted || !this.ambienceEnabled ? 0 : 0.006 + intensity * 0.12;
    if (this.ctx && this.windGain && Math.abs(target - this.lastWindTarget) > 0.002) {
      const now = this.ctx.currentTime; this.windGain.gain.cancelScheduledValues(now); this.windGain.gain.setTargetAtTime(target, now, 0.35); this.lastWindTarget = target;
    }
    this.updateAmbience();
  }
  sfx(id: SfxId): void {
    if (this.disposed || this.muted || !this.sfxEnabled || this.sfxVolume <= 0) return;
    this.emitted[id] = (this.emitted[id] ?? 0) + 1; this.ensureCtx();
    const audio = this.effects.get(id)!; const mix = SFX_MIX[id];
    audio.pause(); audio.currentTime = 0; audio.playbackRate = mix.rate; audio.volume = Math.min(1, this.volume * this.sfxVolume * mix.volume);
    void audio.play().catch(() => undefined);
  }
  state(): { music: string; repair: string; ambience: string; musicLoop: boolean; muted: boolean; musicEnabled: boolean; sfxEnabled: boolean; ambienceEnabled: boolean; musicVolume: number; sfxVolume: number; ambienceVolume: number; track: MusicTrack; context: AudioContextState | "uninitialized"; musicReady: number; musicPaused: boolean; musicTime: number; ambienceReady: number; ambiencePaused: boolean; ambienceTime: number; repairReady: number; repairPaused: boolean; emitted: Partial<Record<SfxId, number>> } {
    return {
      music: this.music.src.split("/").pop() ?? "", repair: this.repair.src.split("/").pop() ?? "", ambience: this.ambience.src.split("/").pop() ?? "", musicLoop: this.music.loop, muted: this.muted,
      musicEnabled: this.musicEnabled, sfxEnabled: this.sfxEnabled, ambienceEnabled: this.ambienceEnabled,
      musicVolume: this.musicVolume, sfxVolume: this.sfxVolume, ambienceVolume: this.ambienceVolume, track: this.musicTrack,
      context: this.ctx?.state ?? "uninitialized", musicReady: this.music.readyState, musicPaused: this.music.paused, musicTime: this.music.currentTime,
      ambienceReady: this.ambience.readyState, ambiencePaused: this.ambience.paused, ambienceTime: this.ambience.currentTime,
      repairReady: this.repair.readyState, repairPaused: this.repair.paused, emitted: { ...this.emitted },
    };
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.detachUnlock();
    for (const audio of [this.ambience, this.music, this.clearingAudio, ...this.effects.values()]) { audio.pause(); audio.src = ""; }
    for (const source of this.sources) { try { source.stop(); } catch { /* already stopped */ } }
    this.sources = []; this.master?.disconnect(); this.master = null; this.ambienceBus = null;
    const ctx = this.ctx; this.ctx = null; if (ctx && ctx.state !== "closed") void ctx.close();
  }
}
