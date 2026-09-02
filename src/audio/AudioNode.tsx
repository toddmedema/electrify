import { MUSIC_FADE_SECONDS } from "../Constants";

export class AudioNode {
  private context: AudioContext;
  private buffer: AudioBuffer;
  private output: AudioDestinationNode | GainNode;
  private gain: GainNode | null;
  private source: AudioBufferSourceNode | null;

  constructor(
    audioContext: AudioContext,
    buffer: AudioBuffer,
    output: AudioDestinationNode | GainNode = audioContext.destination,
  ) {
    this.buffer = buffer;
    this.context = audioContext;
    this.output = output;
    this.gain = null;
    this.source = null;
  }

  /** Routes future playbacks through a shared bus, used for independent music volume. */
  public setOutput(output: AudioDestinationNode | GainNode) {
    this.output = output;
  }

  /**
   * Buffer sources are single-use: stopping one throws it away, so picking a track back up means
   * building a new source and seeking into the buffer. offsetSeconds is where in the track to
   * start, and startAt is when on the context clock to start it -- ThemeManager passes one shared
   * startAt for every track in a theme so the stems stay aligned with each other.
   */
  public playOnce(
    initialVolume: number = 1,
    fadeInVolume: number = 0,
    offsetSeconds: number = 0,
    startAt?: number,
  ) {
    const when = startAt === undefined ? this.context.currentTime : startAt;
    // Starting past the end of a buffer plays nothing at all, so treat an out-of-range seek as
    // the top of the track: restarting is a worse outcome than resuming, silence is worse still.
    const offset =
      offsetSeconds > 0 && offsetSeconds < this.buffer.duration
        ? offsetSeconds
        : 0;
    this.gain = this.context.createGain();
    this.gain.connect(this.output);
    this.gain.gain.setValueAtTime(initialVolume, when);
    if (fadeInVolume) {
      this.fadeIn(fadeInVolume);
    }
    const source = this.context.createBufferSource();
    this.source = source;
    source.buffer = this.buffer;
    source.connect(this.gain);
    source.start(when, offset);
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
      try {
        source.stop(this.context.currentTime + seconds);
      } catch (_err) {
        // An already-stopped single-use source may reject another stop request.
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

  // ThemeManager uses this as "has playOnce been called"; it intentionally keeps treating a
  // naturally ended source as active so later intensity changes preserve the established mix.
  public isPlaying(): boolean {
    return this.source !== null;
  }
}
