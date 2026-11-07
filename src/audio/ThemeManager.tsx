import {
  MUSIC_DEFINITIONS,
  MUSIC_FADE_SECONDS,
  MUSIC_GAME_VOLUME,
  MUSIC_INTENSITY_MAX,
  MUSIC_LOW_RESERVE_PRESSURE_MAX,
  MusicDefinition,
} from "../Constants";
import { AudioNode } from "./AudioNode";
import { pow } from "../helpers/Pow";

// Web Audio gains are amplitude ratios: -15 dB is 10^(-15/20), about 17.8% gain.
const MUSIC_HIGH_LOW_RESERVE_GAIN = pow(10, -15 / 20);

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

  /** Save the decoded playhead and silence every source, including outgoing crossfades. */
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

  /** Restart the selected scene at its saved playhead with the latest grid pressure. */
  public resume() {
    if (!this.paused) return;
    this.paused = false;
    this.mixedPressure = this.pressure();
    if (this.intensity > 0) this.start(this.resumeOffsetSeconds, 0.1);
  }

  /** Measure progress modulo the decoded loop so pauses across a boundary resume in place. */
  private elapsedInTheme(): number {
    if (this.themeStartedAt === null || !this.active.length) return 0;
    // Use decoded samples, not an independently authored timer or rounded MP3 duration.
    return (
      Math.max(0, this.context.currentTime - this.themeStartedAt) %
      this.active[0].duration
    );
  }

  /** Fade the current scene and clear its playhead before choosing another scene. */
  private stop(seconds = MUSIC_FADE_SECONDS) {
    this.active.forEach((node) => node.fadeOut(seconds));
    this.active = [];
    this.themeStartedAt = null;
  }

  /** Select silence, menu or gameplay, updating pressure without restarting the same scene. */
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

  /** Start every stem at one future audio-clock time and a shared decoded offset. */
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

  /** Bring in the high layer at low reserves, reaching full gain only during blackouts. */
  private trackVolume(track: string): number {
    if (this.theme === MUSIC_DEFINITIONS.menu) {
      return 1;
    }
    const pressure = this.mixedPressure;
    if (track.startsWith("high")) {
      if (pressure === 0) return 0;
      return pressure <= MUSIC_LOW_RESERVE_PRESSURE_MAX
        ? MUSIC_HIGH_LOW_RESERVE_GAIN
        : 1;
    }
    // Keep the supporting layers at 85% when calm, lifting them as pressure rises.
    const lift = track.startsWith("low") ? pressure * pressure : pressure;
    return MUSIC_GAME_VOLUME + (1 - MUSIC_GAME_VOLUME) * lift;
  }

  private clearRecovery() {
    if (this.recoveryTimeout !== null) {
      clearTimeout(this.recoveryTimeout);
      this.recoveryTimeout = null;
    }
  }

  /** Retarget stem gains without shortening an in-progress scene transition. */
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

  /** Respond to worsening pressure immediately and hold brief recoveries before fading down. */
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
