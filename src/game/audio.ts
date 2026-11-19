export type SfxId = "scan" | "pickup" | "deposit" | "upgrade" | "ui" | "warning" | "win" | "lose" | "empty" | "build" | "rail" | "sell" | "robot" | "repair" | "landing";
export type MusicTrack = "quiet-aurora" | "snowglass-drift" | "polar-night" | "none";
const MUTE_KEY = "whiteout.muted";
const TRACK_FILES: Record<Exclude<MusicTrack, "none">, string> = {
  "quiet-aurora": "quiet-aurora-loop.mp3", "snowglass-drift": "snowglass-drift-loop.mp3",
  // Same Polar Night recording, high-passed at 130 Hz so its existing harmonics are audible on laptop speakers.
  "polar-night": "polar-night-loop.mp3",
};
const SFX_FILES: Record<SfxId, string> = {
  scan: "scanner-pulse.mp3", pickup: "pickup-collect.webm", deposit: "landing-soft.mp3", upgrade: "success-chime.mp3",
  ui: "ui-tap.mp3", warning: "warning-cue.mp3", win: "success-chime.mp3", lose: "warning-cue.mp3", empty: "ui-tap.mp3",
  build: "machine-action.mp3", rail: "machine-action.mp3", sell: "sell-confirm.webm", robot: "machine-action.mp3",
  repair: "robot-repair-chime.mp3", landing: "landing-soft.mp3",
};
const SFX_MIX: Record<SfxId, { volume: number; rate: number }> = {
  scan: { volume: 0.72, rate: 1 }, pickup: { volume: 0.5, rate: 1 }, deposit: { volume: 0.46, rate: 1 }, upgrade: { volume: 0.72, rate: 1 },
  ui: { volume: 0.5, rate: 1 }, warning: { volume: 0.72, rate: 1 }, win: { volume: 0.82, rate: 0.92 }, lose: { volume: 0.68, rate: 0.82 },
  empty: { volume: 0.35, rate: 0.78 }, build: { volume: 0.7, rate: 1 }, rail: { volume: 0.64, rate: 1.12 }, sell: { volume: 0.42, rate: 1 },
  robot: { volume: 0.58, rate: 1.12 }, repair: { volume: 0.82, rate: 1 }, landing: { volume: 0.72, rate: 1 },
};
// Clearing rides the existing master bus (0.48 * volume). 0.9 * sfxVolume lands about 2 dB under the old 0.55 element mix; the low-pass removes the rest of the harshness.
const CLEARING_LOWPASS_HZ = 3200;
const CLEARING_FADE_SEC = 0.12;
const CLEARING_TRIM = 0.9;
const CLEARING_RELEASE_GRACE_MS = 80;
function readMuted(): boolean { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } }
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const asset = (name: string): string => new URL(`assets/audio/${name}`, document.baseURI).href;

export class AudioSystem {
  private ctx: AudioContext | null = null; private master: GainNode | null = null;
  private ambienceBus: GainNode | null = null; private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null; private windGust: OscillatorNode | null = null;
  private windGustDepth: GainNode | null = null; private windColorDepth: GainNode | null = null;
  private sources: AudioScheduledSourceNode[] = []; private disposed = false;
  private volume = 0.7; private stormIntensity = 0;
  private ambience = new Audio(asset("arctic-ambience.mp3"));
  private musicA = new Audio(asset(TRACK_FILES["quiet-aurora"])); private musicB = new Audio(); private music = this.musicA;
  private musicOut: HTMLAudioElement | null = null; private musicFade: "in" | "out" | null = null;
  private musicFadeAt = 0; private musicFadeMs = 1100; private musicFadeFrom = 0; private musicFadeTimer: number | null = null;
  // Edited CC0 deep-snow recording (Freesound 558555, bruno.auzet) into one 40.4 s loop.
  private repair: HTMLAudioElement; private clearingAudio = new Audio(asset("snow-clearing-loop.webm"));
  private effects = new Map<SfxId, HTMLAudioElement>();
  private musicTrack: MusicTrack = "quiet-aurora"; private musicEnabled = true; private musicVolume = 0.55;
  private sfxEnabled = true; private sfxVolume = 0.7; private ambienceEnabled = true; private ambienceVolume = 0.55;
  private emitted: Partial<Record<SfxId, number>> = {}; private clearing = false; private lastWindTarget = -1;
  private clearingGain: GainNode | null = null; private clearingFilter: BiquadFilterNode | null = null;
  private clearingSource: MediaElementAudioSourceNode | null = null;
  private clearingPauseTimer: number | null = null; private clearingReleaseTimer: number | null = null;
  muted = readMuted();
  private readonly unlock = () => { this.ensureCtx(); this.detachUnlock(); if (this.clearingAudible()) this.updateClearing(); };
  private readonly onShow = () => { if (!document.hidden && this.ctx?.state === "suspended") void this.ctx.resume().then(() => { if (!this.disposed) this.syncMusic(); }); };
  private readonly onMusicTime = (event: Event) => {
    const audio = event.currentTarget as HTMLAudioElement;
    if (this.disposed || audio !== this.music || this.musicFade || this.musicTrack === "none" || this.muted || !this.musicEnabled) return;
    const left = audio.duration - audio.currentTime;
    if (audio.duration > 1 && left < 1.35 && left > 0.25) this.handoff(this.musicTrack, 800);
  };
  constructor() {
    window.addEventListener("pointerdown", this.unlock); window.addEventListener("keydown", this.unlock); document.addEventListener("visibilitychange", this.onShow);
    for (const id of Object.keys(SFX_FILES) as SfxId[]) {
      const audio = new Audio(asset(SFX_FILES[id])); audio.preload = "auto"; this.effects.set(id, audio);
    }
    this.repair = this.effects.get("repair")!;
    this.ambience.loop = true; this.musicA.loop = true; this.musicB.loop = true; this.clearingAudio.loop = true;
    this.ambience.preload = "auto"; this.musicA.preload = "auto"; this.musicB.preload = "auto"; this.clearingAudio.preload = "auto";
    this.musicA.addEventListener("timeupdate", this.onMusicTime); this.musicB.addEventListener("timeupdate", this.onMusicTime);
    this.updateAmbience();
  }
  private detachUnlock(): void { window.removeEventListener("pointerdown", this.unlock); window.removeEventListener("keydown", this.unlock); }
  private effectiveVolume(): number { return this.muted ? 0 : 0.48 * this.volume; }
  private windLevel(intensity: number): number { return this.muted || !this.ambienceEnabled ? 0 : 0.006 + intensity * 0.12; }
  private windCutoff(intensity: number): number { return 420 + Math.min(intensity, 1.3) * 480; }
  // One 32 s brown-noise bed. A 1.5 s equal-power join removes the loop click; gust and color live on oscillators, not on the buffer period.
  private createWindBed(ctx: AudioContext): AudioBuffer {
    const fade = Math.floor(ctx.sampleRate * 1.5); const length = Math.floor(ctx.sampleRate * 32);
    const raw = new Float32Array(length + fade); let seed = 918273; let brown = 0;
    for (let i = 0; i < raw.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      brown += 0.018 * (((seed >>> 8) / 0x800000 - 1) - brown); raw[i] = brown;
    }
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate); const data = buffer.getChannelData(0);
    data.set(raw.subarray(0, length));
    for (let i = 0; i < fade; i++) {
      const rise = Math.sin((i / fade) * Math.PI * 0.5); const fall = Math.cos((i / fade) * Math.PI * 0.5);
      data[i] = data[i] * rise + raw[length + i] * fall;
    }
    let mean = 0; for (let i = 0; i < length; i++) mean += data[i]; mean /= length;
    let peak = 0;
    for (let i = 0; i < length; i++) { const v = data[i] - mean; data[i] = v; const a = v < 0 ? -v : v; if (a > peak) peak = a; }
    const scale = 0.26 / (peak || 1); for (let i = 0; i < length; i++) data[i] *= scale;
    return buffer;
  }
  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext(); this.ctx = ctx;
      this.master = ctx.createGain(); this.master.gain.value = this.effectiveVolume(); this.master.connect(ctx.destination);
      this.ambienceBus = ctx.createGain(); this.ambienceBus.connect(this.master);
      const source = ctx.createBufferSource(); source.buffer = this.createWindBed(ctx); source.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.Q.value = 0.707; filter.frequency.value = this.windCutoff(this.stormIntensity);
      const gust = ctx.createGain(); gust.gain.value = 1;
      this.windGain = ctx.createGain(); this.windGain.gain.value = this.windLevel(this.stormIntensity); this.lastWindTarget = this.windGain.gain.value;
      const gustLfo = ctx.createOscillator(); gustLfo.type = "sine"; gustLfo.frequency.value = 0.047;
      const colorLfo = ctx.createOscillator(); colorLfo.type = "sine"; colorLfo.frequency.value = 0.031;
      this.windGustDepth = ctx.createGain(); this.windGustDepth.gain.value = 0.07 + this.stormIntensity * 0.11;
      this.windColorDepth = ctx.createGain(); this.windColorDepth.gain.value = 22 + this.stormIntensity * 36;
      gustLfo.connect(this.windGustDepth).connect(gust.gain); colorLfo.connect(this.windColorDepth).connect(filter.frequency);
      source.connect(filter).connect(gust).connect(this.windGain).connect(this.ambienceBus);
      source.start(); gustLfo.start(); colorLfo.start(); this.sources.push(source, gustLfo, colorLfo);
      this.windFilter = filter; this.windGust = gustLfo;
      this.updateAmbience();
      if (this.ambienceEnabled && !this.muted) void this.ambience.play().catch(() => undefined);
      if (this.musicEnabled && this.musicTrack !== "none" && !this.muted) void this.music.play().catch(() => undefined);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume(); return this.ctx;
  }
  private updateAmbience(): void {
    const audible = !this.muted && !this.disposed;
    this.ambience.volume = audible && this.ambienceEnabled ? this.volume * this.ambienceVolume * 0.26 : 0;
    for (const [id, audio] of this.effects) audio.volume = audible && this.sfxEnabled ? Math.min(1, this.volume * this.sfxVolume * SFX_MIX[id].volume) : 0;
    if (!audible || !this.ambienceEnabled) this.ambience.pause(); else if (this.ctx) void this.ambience.play().catch(() => undefined);
    this.syncMusic();
    if (this.ambienceBus && this.ctx) this.ambienceBus.gain.setTargetAtTime(this.ambienceEnabled ? this.ambienceVolume : 0, this.ctx.currentTime, 0.08);
  }
  toggleMute(): boolean {
    this.muted = !this.muted; try { localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0"); } catch { /* session-only */ }
    if (this.master) this.master.gain.setTargetAtTime(this.effectiveVolume(), this.ctx!.currentTime, 0.03); this.updateAmbience(); this.updateClearing(); return this.muted;
  }
  setVolume(value: number): void { this.volume = clamp(value); if (this.master) this.master.gain.setTargetAtTime(this.effectiveVolume(), this.ctx!.currentTime, 0.03); this.updateAmbience(); }
  private musicLevel(): number {
    if (this.muted || this.disposed || !this.musicEnabled || this.musicTrack === "none") return 0;
    return this.volume * this.musicVolume * 0.52 * (1 - Math.min(0.42, this.stormIntensity * 0.3));
  }
  private pointAt(audio: HTMLAudioElement, track: Exclude<MusicTrack, "none">): void {
    const file = TRACK_FILES[track]; if (!audio.src.endsWith(file)) audio.src = asset(file); audio.loop = true;
  }
  private musicOutMark = 0;
  private endFade(): void {
    if (this.musicFadeTimer !== null) { window.clearTimeout(this.musicFadeTimer); this.musicFadeTimer = null; }
    const mode = this.musicFade; this.musicFade = null; const out = this.musicOut; this.musicOut = null;
    if (out) { out.pause(); out.volume = 0; }
    if (mode === "out") { this.music.pause(); this.music.volume = 0; } else if (mode === "in") this.music.volume = this.musicLevel();
  }
  private applyFade(): void {
    const t = Math.min(1, (performance.now() - this.musicFadeAt) / this.musicFadeMs);
    const rise = Math.sin(t * Math.PI * 0.5); const fall = Math.cos(t * Math.PI * 0.5);
    if (this.musicFade === "out") { this.music.volume = this.musicFadeFrom * fall; if (t >= 1) this.endFade(); return; }
    if (this.musicOut && this.musicOut.currentTime + 0.45 < this.musicOutMark) { this.musicOut.pause(); this.musicOut.volume = 0; this.musicOut = null; }
    const full = this.musicLevel(); this.music.volume = full * rise; if (this.musicOut) this.musicOut.volume = full * fall; if (t >= 1) this.endFade();
  }
  private readonly pumpFade = () => {
    this.musicFadeTimer = null; if (!this.musicFade || this.disposed) return; this.applyFade();
    if (this.musicFade) this.musicFadeTimer = window.setTimeout(this.pumpFade, 40);
  };
  private handoff(track: Exclude<MusicTrack, "none">, ms: number): void {
    const incoming = this.music === this.musicA ? this.musicB : this.musicA;
    if (this.musicOut && this.musicOut !== incoming) { this.musicOut.pause(); this.musicOut.volume = 0; }
    this.pointAt(incoming, track); try { incoming.currentTime = 0; } catch { /* metadata still arriving */ }
    incoming.volume = 0; void incoming.play().catch(() => undefined);
    this.musicOutMark = this.music.currentTime; this.musicOut = this.music; this.music = incoming; this.musicFade = "in"; this.musicFadeAt = performance.now(); this.musicFadeMs = ms; this.pumpFade();
  }
  private syncMusic(): void {
    if (this.muted || !this.musicEnabled) { this.endFade(); this.music.pause(); return; }
    if (this.musicFade === "out") { this.applyFade(); return; }
    if (this.musicTrack === "none") { this.endFade(); this.music.pause(); return; }
    if (this.musicFade === "in") this.applyFade(); else this.music.volume = this.musicLevel();
    if (this.ctx && this.music.paused) void this.music.play().catch(() => undefined);
  }
  setMusicTrack(track: MusicTrack): void {
    if (track === this.musicTrack) return; this.musicTrack = track;
    if (!this.ctx || this.muted || !this.musicEnabled) {
      this.endFade(); if (track === "none") { this.music.pause(); this.music.volume = 0; return; }
      this.pointAt(this.music, track); try { this.music.currentTime = 0; } catch { /* not seekable yet */ }
      this.music.volume = 0; return;
    }
    if (track === "none") {
      if (this.music.paused) { this.endFade(); this.music.volume = 0; return; }
      this.musicOut?.pause(); this.musicOut = null; this.musicFadeFrom = this.music.volume || this.musicLevel();
      this.musicFade = "out"; this.musicFadeAt = performance.now(); this.musicFadeMs = 900; this.pumpFade(); return;
    }
    if (this.music.paused) {
      this.endFade(); this.pointAt(this.music, track); try { this.music.currentTime = 0; } catch { /* not seekable yet */ }
      this.music.volume = 0; void this.music.play().catch(() => undefined);
      this.musicFade = "in"; this.musicFadeAt = performance.now(); this.musicFadeMs = 900; this.pumpFade(); return;
    }
    this.handoff(track, 1100);
  }
  setMusicEnabled(enabled: boolean): void { this.musicEnabled = enabled; this.updateAmbience(); }
  setMusicVolume(value: number): void { this.musicVolume = clamp(value); this.updateAmbience(); }
  setSfxEnabled(enabled: boolean): void { this.sfxEnabled = enabled; this.updateAmbience(); this.updateClearing(); }
  setSfxVolume(value: number): void { this.sfxVolume = clamp(value); this.updateAmbience(); this.updateClearing(); }
  setAmbienceEnabled(enabled: boolean): void { this.ambienceEnabled = enabled; this.updateAmbience(); }
  setAmbienceVolume(value: number): void { this.ambienceVolume = clamp(value); this.updateAmbience(); }
  setClearing(active: boolean): void {
    if (this.disposed) return;
    if (active) {
      if (this.clearingReleaseTimer !== null) { window.clearTimeout(this.clearingReleaseTimer); this.clearingReleaseTimer = null; }
      if (this.clearing) return;
      this.clearing = true; this.updateClearing(); return;
    }
    if (!this.clearing || this.clearingReleaseTimer !== null) return;
    // Keep the same playhead through a short gap instead of restarting the six-second file.
    this.clearingReleaseTimer = window.setTimeout(() => {
      this.clearingReleaseTimer = null;
      if (this.disposed) return;
      this.clearing = false; this.updateClearing();
    }, CLEARING_RELEASE_GRACE_MS);
  }
  private clearingAudible(): boolean { return this.clearing && !this.disposed && !this.muted && this.sfxEnabled && this.sfxVolume > 0; }
  private wireClearing(): void {
    if (this.clearingSource || !this.ctx || !this.master) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass"; filter.frequency.value = CLEARING_LOWPASS_HZ; filter.Q.value = 0.707;
    const gain = this.ctx.createGain(); gain.gain.value = 0;
    const source = this.ctx.createMediaElementSource(this.clearingAudio);
    source.connect(filter).connect(gain).connect(this.master);
    this.clearingFilter = filter; this.clearingGain = gain; this.clearingSource = source;
    this.clearingAudio.volume = 1;
  }
  private rampClearing(): void {
    if (!this.clearingGain || !this.ctx) return;
    const now = this.ctx.currentTime; const gain = this.clearingGain.gain; const current = gain.value;
    gain.cancelScheduledValues(now); gain.setValueAtTime(current, now);
    gain.linearRampToValueAtTime(this.clearingAudible() ? this.sfxVolume * CLEARING_TRIM : 0, now + CLEARING_FADE_SEC);
  }
  private updateClearing(): void {
    if (this.disposed) return;
    if (!this.clearingAudible()) {
      if (this.clearingGain) this.rampClearing();
      if (this.clearingAudio.paused || this.clearingPauseTimer !== null) return;
      this.clearingPauseTimer = window.setTimeout(() => {
        this.clearingPauseTimer = null;
        if (this.disposed || this.clearingAudible()) return;
        this.clearingAudio.pause();
      }, CLEARING_FADE_SEC * 1000 + 30);
      return;
    }
    if (this.clearingPauseTimer !== null) { window.clearTimeout(this.clearingPauseTimer); this.clearingPauseTimer = null; }
    this.ensureCtx(); this.wireClearing(); this.rampClearing();
    if (!this.clearingAudio.paused) return;
    const play = () => { if (!this.disposed && this.clearingAudible() && this.clearingAudio.paused) void this.clearingAudio.play().catch(() => undefined); };
    if (this.ctx?.state === "suspended") void this.ctx.resume().then(play); else play();
  }
  setStorm(intensity: number): void {
    if (Math.abs(intensity - this.stormIntensity) < 0.005) return;
    this.stormIntensity = Math.max(0, intensity);
    const target = this.windLevel(this.stormIntensity);
    if (this.ctx && this.windGain && Math.abs(target - this.lastWindTarget) > 0.002) {
      const now = this.ctx.currentTime;
      this.windGain.gain.cancelScheduledValues(now); this.windGain.gain.setTargetAtTime(target, now, 0.55); this.lastWindTarget = target;
      if (this.windFilter) { this.windFilter.frequency.cancelScheduledValues(now); this.windFilter.frequency.setTargetAtTime(this.windCutoff(this.stormIntensity), now, 0.9); }
      if (this.windGustDepth) { this.windGustDepth.gain.cancelScheduledValues(now); this.windGustDepth.gain.setTargetAtTime(0.07 + this.stormIntensity * 0.11, now, 0.9); }
      if (this.windColorDepth) { this.windColorDepth.gain.cancelScheduledValues(now); this.windColorDepth.gain.setTargetAtTime(22 + this.stormIntensity * 36, now, 0.9); }
      if (this.windGust) { this.windGust.frequency.cancelScheduledValues(now); this.windGust.frequency.setTargetAtTime(0.04 + this.stormIntensity * 0.03, now, 1.2); }
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
    if (this.disposed) return; this.disposed = true; this.clearing = false; this.detachUnlock(); document.removeEventListener("visibilitychange", this.onShow);
    if (this.clearingPauseTimer !== null) { window.clearTimeout(this.clearingPauseTimer); this.clearingPauseTimer = null; }
    if (this.clearingReleaseTimer !== null) { window.clearTimeout(this.clearingReleaseTimer); this.clearingReleaseTimer = null; }
    if (this.clearingGain && this.ctx) { const now = this.ctx.currentTime; this.clearingGain.gain.cancelScheduledValues(now); this.clearingGain.gain.setValueAtTime(0, now); }
    this.clearingAudio.pause();
    this.clearingSource?.disconnect(); this.clearingFilter?.disconnect(); this.clearingGain?.disconnect();
    this.endFade(); this.musicA.removeEventListener("timeupdate", this.onMusicTime); this.musicB.removeEventListener("timeupdate", this.onMusicTime);
    for (const audio of [this.ambience, this.musicA, this.musicB, this.clearingAudio, ...this.effects.values()]) { audio.pause(); audio.src = ""; }
    for (const source of this.sources) { try { source.stop(); } catch { /* already stopped */ } }
    this.windFilter?.disconnect(); this.windGustDepth?.disconnect(); this.windColorDepth?.disconnect();
    this.windFilter = null; this.windGust = null; this.windGustDepth = null; this.windColorDepth = null;
    this.sources = []; this.master?.disconnect(); this.master = null; this.ambienceBus = null; this.windGain = null;
    const ctx = this.ctx; this.ctx = null; if (ctx && ctx.state !== "closed") void ctx.close();
  }
}
