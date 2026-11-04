import {
  MUSIC_DEFINITIONS,
  MUSIC_FADE_SECONDS,
  MUSIC_GAME_VOLUME,
  MUSIC_INTENSITY_MAX,
  MusicDefinition,
} from "../Constants";
import { AudioNode } from "./AudioNode";

export const MUSIC_PRESSURE_HOLD_MS = 8000;
export const MUSIC_PRESSURE_ATTACK_SECONDS = 3;
export const MUSIC_PRESSURE_RELEASE_SECONDS = 10;
// A long pause tail would overlap a second copy of the song after a quick mute/unmute.
export const MUSIC_PAUSE_FADE_SECONDS = 0.05;

/** Owns scene changes and mixing. Repetition belongs entirely to the native audio clock. */
export class ThemeManager {
  private intensity = 0;
  private paused = false;
  private theme: MusicDefinition = MUSIC_DEFINITIONS.menu;
  private active: AudioNode[] = [];
  private themeStartedAt: number | null = null;
  private resumeOffsetSeconds = 0;
  private recoveryTimeout: ReturnType<typeof setTimeout> | null = null;
  private mixedPressure = 0;
  private transitionEndsAt = 0;

  constructor(
    private context: AudioContext,
    private nodes: Record<string, AudioNode>,
  ) {}

  public pause() {
    if (this.paused) return;
    this.paused = true;
    this.resumeOffsetSeconds = this.elapsedInTheme();
    this.clearRecovery();
    Object.values(this.nodes).forEach((node) =>
      node.stopAll(MUSIC_PAUSE_FADE_SECONDS),
    );
    this.active = [];
    this.themeStartedAt = null;
  }

  public resume() {
    if (!this.paused) return;
    this.paused = false;
    this.mixedPressure = this.pressure();
    if (this.intensity > 0) this.start(this.resumeOffsetSeconds, 0.1);
  }

  private elapsedInTheme(): number {
    if (this.themeStartedAt === null || !this.active.length) return 0;
    // Use decoded samples, not an independently authored timer or rounded MP3 duration.
    return (
      Math.max(0, this.context.currentTime - this.themeStartedAt) %
      this.active[0].duration
    );
  }

  private stop(seconds = MUSIC_FADE_SECONDS) {
    this.active.forEach((node) => node.fadeOut(seconds));
    this.active = [];
    this.themeStartedAt = null;
  }

  public setIntensity(intensity: number) {
    intensity = Number.isFinite(intensity)
      ? Math.min(MUSIC_INTENSITY_MAX, Math.max(0, intensity))
      : 0;
    if (intensity === this.intensity) return;
    const previous = this.intensity;
    this.intensity = intensity;
    if (intensity === 0) {
      this.clearRecovery();
      this.stop();
      this.resumeOffsetSeconds = 0;
      return;
    }
    const theme =
      intensity === 1 ? MUSIC_DEFINITIONS.menu : MUSIC_DEFINITIONS.basic;
    if (previous === 0 || theme !== this.theme) {
      this.clearRecovery();
      this.stop();
      this.theme = theme;
      this.resumeOffsetSeconds = 0;
      this.mixedPressure = this.pressure();
      if (!this.paused)
        this.start(
          0,
          previous === 0 && intensity === 1 ? 0.1 : MUSIC_FADE_SECONDS,
        );
    } else if (!this.paused) {
      this.updateTheme();
    }
  }

  private start(offsetSeconds = 0, fadeSeconds = MUSIC_FADE_SECONDS) {
    // Schedule every stem slightly ahead on one clock, so creating nodes cannot stagger them.
    const startAt = this.context.currentTime + 0.02;
    this.themeStartedAt = startAt - offsetSeconds;
    this.transitionEndsAt = startAt + fadeSeconds;
    this.active = this.theme.tracks.map((track) => {
      const node = this.nodes[`${this.theme.directory}${track}`];
      node.play(this.trackVolume(track), offsetSeconds, startAt, fadeSeconds);
      return node;
    });
  }

  private pressure(): number {
    return Math.max(0, (this.intensity - 2) / (MUSIC_INTENSITY_MAX - 2));
  }

  private trackVolume(track: string): number {
    if (this.theme === MUSIC_DEFINITIONS.menu) {
      return 1;
    }
    // Keep every authored layer at 85% when stable. Lift the urgent high layer first, then the
    // medium and low layers, reaching the original ceiling together in a severe blackout.
    const pressure = this.mixedPressure;
    const lift = track.startsWith("high")
      ? Math.sqrt(pressure)
      : track.startsWith("low")
        ? pressure * pressure
        : pressure;
    return MUSIC_GAME_VOLUME + (1 - MUSIC_GAME_VOLUME) * lift;
  }

  private clearRecovery() {
    if (this.recoveryTimeout !== null) {
      clearTimeout(this.recoveryTimeout);
      this.recoveryTimeout = null;
    }
  }

  private updateMix(seconds: number) {
    // Grid changes during the scene fade must not shorten the five-second arrival.
    const duration = Math.max(
      seconds,
      this.transitionEndsAt - this.context.currentTime,
    );
    this.theme.tracks.forEach((track) => {
      this.nodes[`${this.theme.directory}${track}`]?.fadeTo(
        this.trackVolume(track),
        duration,
      );
    });
  }

  private updateTheme() {
    const pressure = this.pressure();
    if (pressure >= this.mixedPressure) {
      this.clearRecovery();
      if (pressure > this.mixedPressure) {
        this.mixedPressure = pressure;
        this.updateMix(MUSIC_PRESSURE_ATTACK_SECONDS);
      }
    } else if (this.recoveryTimeout === null) {
      // Hold through brief recoveries so fast simulation ticks cannot make the mix flutter.
      // Read the latest pressure after the hold rather than using a stale grid state.
      this.recoveryTimeout = setTimeout(() => {
        this.recoveryTimeout = null;
        this.mixedPressure = this.pressure();
        this.updateMix(MUSIC_PRESSURE_RELEASE_SECONDS);
      }, MUSIC_PRESSURE_HOLD_MS);
    }
  }
}
