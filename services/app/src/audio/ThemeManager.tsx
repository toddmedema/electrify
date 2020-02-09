import {MUSIC_DEFINITIONS, MUSIC_FADE_SECONDS, MUSIC_INTENSITY_MAX, MusicDefinition} from '../Constants';
import {AudioNode} from './AudioNode';

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
*/

const MUSIC_FADE_LONG_SECONDS = 3.5; // for fade outs, such as the end of combat

export class ThemeManager {
  private nodes: {
    [key: string]: AudioNode;
  };
  private active: string[];

  private intensity: number;
  private paused: boolean;
  private theme: MusicDefinition;
  private timeout: any;

  constructor(nodes: {[key: string]: AudioNode}) {
    this.nodes = nodes;
    this.active = [];
    for (const k of Object.keys(this.nodes)) {
      if (this.nodes[k].isPlaying()) {
        this.active.push(k);
      }
    }
    this.theme = MUSIC_DEFINITIONS.intro;
    this.paused = false;
    this.intensity = 0;
  }

  public pause() {
    if (this.paused) {
      return;
    }
    this.paused = true;
    this.fadeOut();
  }
  private fadeOut() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    for (const i of this.active) {
      if (this.nodes[i] && this.nodes[i].isPlaying()) {
        this.nodes[i].fadeOut((this.intensity > 0) ? MUSIC_FADE_SECONDS : MUSIC_FADE_LONG_SECONDS, true);
      }
    }
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public setIntensity(intensity: number) {
    intensity = Math.round(Math.min(MUSIC_INTENSITY_MAX, Math.max(0, intensity)));
    if (intensity !== this.intensity) {
      this.playAtIntensity(intensity);
    }
  }

  // Starts the music from scratch with a new theme, fading out any existing music
  // If no theme specified, uses existing music (for example, resuming from a pause)
  private startTheme(theme: MusicDefinition = this.theme) {
    this.fadeOut();
    this.theme = theme;
    if (theme) {
      console.log('starting ' + theme.directory);
    }
    this.loopTheme(true);
  }

  public resume() {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.startTheme();
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

  public getActiveInstrument(instrument: string): string|null {
    for (const a of this.active) {
      if (a.indexOf(instrument) !== -1) {
        return a;
      }
    }
    return null;
  }

  // Kick off a copy of the existing music theme
  // Doesn't stop the current music nodes (lets them stop naturally for reverb)
  private loopTheme(newTheme: boolean = false) {
    if (this.paused) {
      return console.log('Skipping music (paused)');
    }
    const theme = this.theme;
    this.active = this.generateTracks();
    theme.tracks.forEach((track: string, i: number) => {
      let file = this.getActiveInstrument(track);
      const active = this.intensity > 0 || Boolean(file);
      file = file || `${theme.directory}${track}`;

      // Add silent tracks to the active set
      if (!active) {
        this.active.push(file);
      }

      const node = this.nodes[file];
      if (!node) {
        console.log(file + ' not loaded');
        return;
      }

      // Determine initial & target volume
      const initialVolume = (newTheme || !active) ? 0 : 1;
      const targetVolume = active ? 1 : 0;
      node.playOnce(initialVolume, targetVolume);
    });

    this.timeout = setTimeout(() => {
      if (this.intensity === 1) {
        this.intensity = 2;
        this.startTheme(MUSIC_DEFINITIONS.basic);
      } else {
        this.loopTheme();
      }
    }, theme.durationMs);
  }

  // Fade in / out tracks on the current theme for a smoother + more immediate change in intensity
  private updateTheme(delta: number) {
    const theme = this.theme;

    if (delta > 0) {
      // Fade in one inaudible (but active) baseline track randomly
      // (don't touch peak instrument, don't duplicate instruments)
      console.log('looking for node to fade in');
      for (const inst of theme.tracks) {
        const activeinst = this.getActiveInstrument(inst) || '';
        console.log(activeinst);
        const a = this.nodes[activeinst];
        if (a && a.isPlaying() && (a.getVolume() || 0) < 1.0) {
          console.log('fading in ' + activeinst);
          a.fadeIn();
          break;
        }
      }
    } else if (delta < 0 && this.active.length > 1) {
      // Fade out one random audible baseline track randomly
      // (don't touch the peak instrument, don't go below 1 active instrument)
      for (const inst of [...theme.tracks].reverse()) {
        const activeinst = this.getActiveInstrument(inst) || '';
        console.log(activeinst);
        const a = this.nodes[activeinst];
        if (a && a.isPlaying() && (a.getVolume() || 0) > 0.9) {
          console.log('fading out ' + activeinst);
          a.fadeOut();
          break;
        }
      }
    }
  }
}
