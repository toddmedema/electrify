import { MUSIC_FADE_SECONDS } from "../Constants";

interface Playback {
  source: AudioBufferSourceNode;
  gain: GainNode;
  startsAt: number;
}

export class AudioNode {
  private context: AudioContext;
  private buffer: AudioBuffer;
  private output: AudioDestinationNode | GainNode;
  private current?: Playback;
  private playbacks = new Set<Playback>();

  constructor(
    audioContext: AudioContext,
    buffer: AudioBuffer,
    output: AudioDestinationNode | GainNode = audioContext.destination,
  ) {
    this.buffer = buffer;
    this.context = audioContext;
    this.output = output;
  }

  public get duration(): number {
    return this.buffer.duration;
  }

  /** Routes future playbacks through a shared bus, used for independent music volume. */
  public setOutput(output: AudioDestinationNode | GainNode) {
    this.output = output;
  }

  /** Loops are native. An ending fade instead plays the remaining buffer once. */
  public play(
    volume: number,
    offsetSeconds: number,
    when: number,
    fadeSeconds: number,
    endingFadeSeconds?: number,
  ) {
    const looping = endingFadeSeconds === undefined;
    const offset = looping
      ? Math.max(0, offsetSeconds) % this.duration
      : Math.min(this.duration, Math.max(0, offsetSeconds));
    const remaining = this.duration - offset;
    const fadeIn = looping ? fadeSeconds : Math.min(fadeSeconds, remaining / 2);
    const gain = this.context.createGain();
    gain.connect(this.output);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(volume, when + fadeIn);
    if (endingFadeSeconds !== undefined) {
      gain.gain.setValueAtTime(
        volume,
        when + Math.max(fadeIn, remaining - endingFadeSeconds),
      );
      gain.gain.linearRampToValueAtTime(0, when + remaining);
    }
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.loop = looping;
    const playback = { source, gain, startsAt: when };
    this.current = playback;
    this.playbacks.add(playback);
    source.connect(gain);
    source.onended = () => {
      this.playbacks.delete(playback);
      if (this.current === playback) this.current = undefined;
      source.disconnect();
      gain.disconnect();
    };
    source.start(when, offset);
  }

  /** Retarget an in-flight fade from its audible level rather than queueing competing ramps. */
  public fadeTo(volume: number, seconds: number) {
    const playback = this.current;
    if (!playback) return;
    const { gain, startsAt } = playback;
    if (this.context.currentTime < startsAt) {
      gain.gain.cancelScheduledValues(startsAt);
      gain.gain.setValueAtTime(0, startsAt);
      gain.gain.linearRampToValueAtTime(volume, startsAt + seconds);
    } else this.fadeGain(gain, volume, seconds);
  }

  /** Replace pending automation while preserving the current level on older Web Audio engines. */
  private fadeGain(gain: GainNode, volume: number, seconds: number) {
    const param = gain.gain;
    const now = this.context.currentTime;
    if (typeof param.cancelAndHoldAtTime === "function") {
      param.cancelAndHoldAtTime(now);
    } else {
      const current = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(current, now);
    }
    param.linearRampToValueAtTime(volume, now + seconds);
  }

  /** Fade and stop the current source while retaining older crossfades until their own stops. */
  public fadeOut(seconds = MUSIC_FADE_SECONDS) {
    if (!this.current) return;
    this.stopPlayback(this.current, seconds);
    this.current = undefined;
  }

  /** Also silence outgoing crossfades, including an older copy of this same track. */
  public stopAll(seconds: number) {
    for (const playback of this.playbacks) this.stopPlayback(playback, seconds);
    this.current = undefined;
  }

  private stopPlayback({ source, gain, startsAt }: Playback, seconds: number) {
    const now = this.context.currentTime;
    if (now < startsAt) {
      source.stop(now);
      return;
    }
    this.fadeGain(gain, 0, seconds);
    source.stop(now + seconds);
  }
}
