import {
  MUSIC_DEFINITIONS,
  MUSIC_FADE_SECONDS,
  MUSIC_GAME_VOLUME,
  MUSIC_INTENSITY_MAX,
  MusicDefinition,
} from "../Constants";
import { AudioNode } from "./AudioNode";

/* Notes on audio implementation:
- intensity 0 stops music, 1 selects the menu loop, and 2-10 adds pressure to the gameplay mix.
  The current game state selects the theme; waiting in a menu never advances to gameplay music.
- some people say that exponentialRampToValueAtTime sounds better than linear ramping;
  after several experiments, I've decided it actually sounds worse for our use case.
- gameplay files are purposefully longer than their listed durationMs for their reverb tails.
  The menu WAV has an exact loop boundary and repeats natively on the audio clock.
- audio.enabled only changes from detecting incompatibility, or user changing the setting
  and so behaves like an all-stop since it's unlikely to be turned back on that session
  - for example, if this is initialized with audio disabled, it does not load audio files -
    but, if you turn on audio later in the session, it'll download them at that time
- audio.paused may change at any time (such as minimizing / returning to the tab),
  so it behaves like pause / resume
- pause / resume keeps its place in the theme rather than starting it over. Buffer sources are
  single-use, so resuming rebuilds them and seeks in; the position is tracked here at the theme
  level rather than per node, since the stems have to stay aligned with each other.
*/

export const MUSIC_PRESSURE_HOLD_MS = 8000;
export const MUSIC_PRESSURE_ATTACK_SECONDS = 3;
export const MUSIC_PRESSURE_RELEASE_SECONDS = 10;

export class ThemeManager {
  private context: AudioContext;
  private nodes: {
    [key: string]: AudioNode;
  };
  private active: string[];

  private intensity: number;
  private paused: boolean;
  private theme: MusicDefinition;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private loopResumeListener: (() => void) | null = null;
  private recoveryTimeout: ReturnType<typeof setTimeout> | null = null;
  private mixedPressure = 0;
  private transitionEndsAt = 0;
  // Context time at which the current theme would have started playing from its first sample, or
  // null when nothing is playing. Backdated when a theme starts part-way through, so that the
  // elapsed position is always currentTime - themeStartedAt.
  private themeStartedAt: number | null = null;
  private resumeOffsetSeconds: number = 0;

  constructor(
    context: AudioContext,
    nodes: { [key: string]: AudioNode },
    intensity: number = 0,
  ) {
    this.context = context;
    this.nodes = nodes;
    this.active = [];
    for (const k of Object.keys(this.nodes)) {
      if (this.nodes[k].isPlaying()) {
        this.active.push(k);
      }
    }
    this.theme = MUSIC_DEFINITIONS.menu;
    this.paused = false;
    this.intensity = intensity;
  }

  public pause() {
    if (this.paused) {
      return;
    }
    this.paused = true;
    // Stamp our place in the theme before fadeOut() tears the sources down. Taken at the moment
    // pause is requested, so the fade-out tail -- which keeps sounding for up to
    // MUSIC_FADE_SECONDS after this -- gets replayed under the fade-in on the way back.
    // Replaying that brief tail under a fade reads as natural.
    this.resumeOffsetSeconds = this.elapsedInTheme();
    this.clearRecovery();
    this.fadeOut();
  }

  // How far into the current theme we are, in seconds. Zero when nothing is playing, or when the
  // loop timer ran long enough that we are past the end of the theme and starting it over is the
  // only sensible position.
  private elapsedInTheme(): number {
    if (this.themeStartedAt === null) {
      return 0;
    }
    const elapsed = this.context.currentTime - this.themeStartedAt;
    if (this.theme.loop && elapsed > 0) {
      return elapsed % (this.theme.durationMs / 1000);
    }
    if (elapsed <= 0 || elapsed >= this.theme.durationMs / 1000) {
      return 0;
    }
    return elapsed;
  }

  private fadeOut() {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this.loopResumeListener !== null) {
      this.context.removeEventListener("statechange", this.loopResumeListener);
      this.loopResumeListener = null;
    }
    // Every caller of this is ending the current playback, so there is no longer a position to
    // measure against -- loopTheme sets it again when it starts the next one.
    this.themeStartedAt = null;
    for (const i of this.active) {
      if (this.nodes[i] && this.nodes[i].isPlaying()) {
        this.nodes[i].fadeOut(MUSIC_FADE_SECONDS, true);
      }
    }
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public setIntensity(intensity: number) {
    intensity = Number.isFinite(intensity)
      ? Math.min(MUSIC_INTENSITY_MAX, Math.max(0, intensity))
      : 0;
    if (intensity !== this.intensity) {
      this.playAtIntensity(intensity);
    }
  }

  // Starts the music with a new theme, fading out any existing music
  // If no theme specified, uses existing music (for example, resuming from a pause)
  // offsetSeconds seeks into the theme, so that a resume picks up where the pause left off
  private startTheme(
    theme: MusicDefinition = this.theme,
    offsetSeconds: number = 0,
  ) {
    this.fadeOut();
    this.theme = theme;
    this.resumeOffsetSeconds = offsetSeconds;
    this.transitionEndsAt = this.context.currentTime + MUSIC_FADE_SECONDS;
    this.loopTheme(true, offsetSeconds);
  }

  public resume() {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    if (this.intensity === 0) {
      return;
    }
    const offsetSeconds = this.resumeOffsetSeconds;
    this.resumeOffsetSeconds = 0;
    this.mixedPressure = this.pressure();
    this.startTheme(this.theme, offsetSeconds);
  }

  private playAtIntensity(newIntensity: number) {
    const old = this.intensity;
    this.intensity = newIntensity;
    if (newIntensity === 0) {
      // Stopping music
      this.clearRecovery();
      this.fadeOut();
      this.active = [];
    } else {
      const theme =
        newIntensity === 1 ? MUSIC_DEFINITIONS.menu : MUSIC_DEFINITIONS.basic;
      if (old === 0 || theme !== this.theme) {
        this.clearRecovery();
        this.mixedPressure = this.pressure();
        this.startTheme(theme);
      } else if (!this.paused) {
        this.updateTheme();
      }
    }
  }

  private generateTracks(): string[] {
    const theme = this.theme;
    return theme.tracks.map((i: string) => {
      return `${theme.directory}${i}`;
    });
  }

  public getActiveInstrument(instrument: string): string | null {
    for (const a of this.active) {
      if (a.indexOf(instrument) !== -1) {
        return a;
      }
    }
    return null;
  }

  // Kick off a copy of the existing music theme
  // Doesn't stop the current music nodes (lets them stop naturally for reverb)
  // offsetSeconds starts every track that far in, for resuming a theme part-way through
  private loopTheme(newTheme: boolean = false, offsetSeconds: number = 0) {
    if (this.paused) {
      return;
    }
    const theme = this.theme;
    this.active = this.generateTracks();
    // One clock reading shared by every track in the theme: the stems are written to play on top
    // of each other, so reading the clock per track would let them drift apart by however long
    // the loop below takes to run.
    const startAt = this.context.currentTime;
    this.themeStartedAt = startAt - offsetSeconds;
    theme.tracks.forEach((track: string) => {
      let file = this.getActiveInstrument(track);
      const active = this.intensity > 0 || Boolean(file);
      file = file || `${theme.directory}${track}`;

      // Add silent tracks to the active set
      if (!active) {
        this.active.push(file);
      }

      const node = this.nodes[file];
      if (!node) {
        // Every file a theme names is loaded up front, and a failure there is already reported
        // by loadAudioFiles -- so reaching this means MUSIC_DEFINITIONS names a track that
        // getAllMusicFiles never fetched, which is a content bug rather than a runtime hiccup.
        console.warn(`No audio node for ${file}; skipping that track`);
        return;
      }

      // Determine initial & target volume
      const targetVolume = active ? this.trackVolume(track) : 0;
      const initialVolume = newTheme || !active ? 0 : targetVolume;
      node.playOnce(
        initialVolume,
        targetVolume,
        offsetSeconds,
        startAt,
        theme.loop,
      );
    });

    // The menu WAV is an exact loop, with no encoder padding or reverb tail to overlap.
    // Web Audio repeats it on its own sample clock, including in throttled background tabs.
    if (theme.loop) {
      return;
    }

    this.scheduleLoop();
  }

  private scheduleLoop() {
    if (this.themeStartedAt === null || this.paused || this.theme.loop) {
      return;
    }
    // JavaScript timers can keep advancing while the browser's audio clock is suspended.
    // Wait for that clock to restart rather than polling a nearly finished track in a loop.
    if (this.context.state !== "running") {
      if (this.context.state !== "closed") {
        const onStateChange = () => {
          if (
            this.context.state !== "running" &&
            this.context.state !== "closed"
          ) {
            return;
          }
          this.context.removeEventListener("statechange", onStateChange);
          this.loopResumeListener = null;
          this.scheduleLoop();
        };
        this.loopResumeListener = onStateChange;
        this.context.addEventListener("statechange", onStateChange);
      }
      return;
    }

    // A timer is only a wake-up: the playhead decides when the theme has actually finished.
    // Backdating themeStartedAt on resume also keeps this deadline at the original loop boundary.
    const remainingMs =
      (this.themeStartedAt +
        this.theme.durationMs / 1000 -
        this.context.currentTime) *
      1000;
    if (remainingMs <= 0) {
      this.loopTheme();
      return;
    }
    this.timeout = setTimeout(
      () => {
        this.timeout = null;
        this.scheduleLoop();
      },
      Math.max(1, Math.ceil(remainingMs)),
    );
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
      // Read the latest pressure after the hold rather than replaying a stale grid state.
      this.recoveryTimeout = setTimeout(() => {
        this.recoveryTimeout = null;
        this.mixedPressure = this.pressure();
        this.updateMix(MUSIC_PRESSURE_RELEASE_SECONDS);
      }, MUSIC_PRESSURE_HOLD_MS);
    }
  }
}
