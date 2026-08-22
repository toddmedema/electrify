import { MUSIC_FADE_SECONDS } from "../Constants";

/**
 * Pre-standard Web Audio names this class still guards for. Browsers of the Safari 6 / Chrome 20
 * era exposed noteOn/noteOff rather than start/stop, and reported playback through
 * playbackState. None of them exist in a current browser, so every one of these is optional.
 */
interface LegacyBufferSource extends AudioBufferSourceNode {
  noteOn?: AudioBufferSourceNode["start"];
  noteOff?: AudioBufferSourceNode["stop"];
  playbackState?: number;
  PLAYING_STATE?: number;
}

export class AudioNode {
  private context: AudioContext;
  private buffer: AudioBuffer;
  private gain: GainNode | null;
  private source: LegacyBufferSource | null;

  constructor(audioContext: AudioContext, buffer: AudioBuffer) {
    this.buffer = buffer;
    this.context = audioContext;
    this.gain = null;
    this.source = null;
  }

  public playOnce(initialVolume: number = 1, fadeInVolume: number = 0) {
    this.gain = this.context.createGain();
    this.gain.connect(this.context.destination);
    this.gain.gain.setValueAtTime(initialVolume, this.context.currentTime);
    if (fadeInVolume) {
      this.fadeIn(fadeInVolume);
    }
    const source: LegacyBufferSource = this.context.createBufferSource();
    this.source = source;
    source.buffer = this.buffer;
    source.connect(this.gain);
    source.start = source.start || source.noteOn; // polyfill for old browsers
    source.start(0);
  }

  public fadeIn(peak?: number, seconds?: number) {
    if (!this.gain) {
      return;
    }
    this.gain.gain.linearRampToValueAtTime(
      peak || 1.0,
      this.context.currentTime + (seconds || MUSIC_FADE_SECONDS),
    );
  }

  public fadeOut(seconds?: number, stop?: boolean) {
    if (seconds === undefined) {
      seconds = MUSIC_FADE_SECONDS;
    }
    const gain = this.gain;
    if (!gain) {
      return;
    }
    gain.gain.linearRampToValueAtTime(0, this.context.currentTime + seconds);
    if (stop && this.source) {
      const source = this.source;
      source.stop = source.stop || source.noteOff; // polyfill for old browsers
      try {
        source.stop(this.context.currentTime + seconds);
      } catch (_err) {
        // polyfill for iOS
        gain.disconnect();
      }
    }
  }

  public getVolume(): number | null {
    if (!this.gain) {
      return null;
    }
    return this.gain.gain.value;
  }

  // NOTE: playbackState and PLAYING_STATE are both undefined in any browser released this
  // decade, so this comparison holds whenever a source exists -- meaning the answer is really
  // "has playOnce been called", and a node never reports itself as finished. Preserved as-is
  // because the music fading in ThemeManager is tuned around the current behaviour; fixing it
  // means tracking completion off the source's ended event.
  public isPlaying(): boolean {
    return Boolean(
      this.source && this.source.playbackState === this.source.PLAYING_STATE,
    );
  }
}
