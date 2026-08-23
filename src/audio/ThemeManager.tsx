import {
  MUSIC_DEFINITIONS,
  MUSIC_FADE_SECONDS,
  MUSIC_INTENSITY_MAX,
  MusicDefinition,
} from "../Constants";
import { AudioNode } from "./AudioNode";

/* Notes on audio implementation:
- intensity (0-MUSIC_INTENSITY_MAX) used as baseline for combat situation, and changes slowly (mostly on loop reset).
  User hears as different tracks on the four baseline instruments (drums, low strings, low brass, high strings)
- peak intensity (0-1) used for quick changes, such as the timer.
  User hears as the matching high brass track.
- some people say that exponentialRampToValueAtTime sounds better than linear ramping;
  after several experiments, I've decided it actually sounds worse for our use case.
- music files are purposefully longer than their listed durationMs, so that they have time
  to wrap up their echoes / reverbs
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

const MUSIC_FADE_LONG_SECONDS = 3.5; // for fade outs, such as the end of combat

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
    this.theme = MUSIC_DEFINITIONS.intro;
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
    // MUSIC_FADE_LONG_SECONDS after this -- gets replayed under the fade-in on the way back.
    // That rewind is a couple of seconds at most and sits under a fade, so it reads as natural.
    this.resumeOffsetSeconds = this.elapsedInTheme();
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
    if (elapsed <= 0 || elapsed >= this.theme.durationMs / 1000) {
      return 0;
    }
    return elapsed;
  }

  private fadeOut() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    // Every caller of this is ending the current playback, so there is no longer a position to
    // measure against -- loopTheme sets it again when it starts the next one.
    this.themeStartedAt = null;
    for (const i of this.active) {
      if (this.nodes[i] && this.nodes[i].isPlaying()) {
        this.nodes[i].fadeOut(
          this.intensity > 0 ? MUSIC_FADE_SECONDS : MUSIC_FADE_LONG_SECONDS,
          true,
        );
      }
    }
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public setIntensity(intensity: number) {
    intensity = Math.round(
      Math.min(MUSIC_INTENSITY_MAX, Math.max(0, intensity)),
    );
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
    this.loopTheme(true, offsetSeconds);
  }

  public resume() {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    const offsetSeconds = this.resumeOffsetSeconds;
    this.resumeOffsetSeconds = 0;
    this.startTheme(this.theme, offsetSeconds);
  }

  private playAtIntensity(newIntensity: number) {
    const old = this.intensity;
    this.intensity = newIntensity;
    if (newIntensity === 0) {
      // Stopping music
      this.active = [];
      this.fadeOut();
    } else if (old === 0) {
      // Starting from silence
      if (newIntensity === 1) {
        this.startTheme(MUSIC_DEFINITIONS.intro);
      } else {
        this.startTheme(MUSIC_DEFINITIONS.basic);
      }
    } else {
      // Shift in existing music
      this.updateTheme(newIntensity - old);
    }
  }

  private generateTracks(): string[] {
    const theme = this.theme;
    return theme.tracks.map((i: string) => {
      return `${theme.directory}${i}`; // e.g. combat/light/HighBrass4
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
      const initialVolume = newTheme || !active ? 0 : 1;
      const targetVolume = active ? 1 : 0;
      node.playOnce(initialVolume, targetVolume, offsetSeconds, startAt);
    });

    // Wrap the theme when it actually ends. A theme resumed part-way through has that much less
    // left to play, so arming this with the full duration would push the loop boundary later on
    // every pause / resume.
    this.timeout = setTimeout(
      () => {
        if (this.intensity === 1) {
          this.intensity = 2;
          this.startTheme(MUSIC_DEFINITIONS.basic);
        } else {
          this.loopTheme();
        }
      },
      theme.durationMs - offsetSeconds * 1000,
    );
  }

  // Fade in / out tracks on the current theme for a smoother + more immediate change in intensity
  private updateTheme(delta: number) {
    const theme = this.theme;

    if (delta > 0) {
      // Fade in one inaudible (but active) baseline track randomly
      // (don't touch peak instrument, don't duplicate instruments)
      for (const inst of theme.tracks) {
        const activeinst = this.getActiveInstrument(inst) || "";
        const a = this.nodes[activeinst];
        if (a && a.isPlaying() && (a.getVolume() || 0) < 1.0) {
          a.fadeIn();
          break;
        }
      }
    } else if (delta < 0 && this.active.length > 1) {
      // Fade out one random audible baseline track randomly
      // (don't touch the peak instrument, don't go below 1 active instrument)
      for (const inst of [...theme.tracks].reverse()) {
        const activeinst = this.getActiveInstrument(inst) || "";
        const a = this.nodes[activeinst];
        if (a && a.isPlaying() && (a.getVolume() || 0) > 0.9) {
          a.fadeOut();
          break;
        }
      }
    }
  }
}
