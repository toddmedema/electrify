import { MUSIC_FADE_SECONDS } from "../Constants";

export class AudioNode {
  private context: AudioContext;
  private buffer: AudioBuffer;
  private output: AudioDestinationNode | GainNode;
  private gain: GainNode | null;
  private source: AudioBufferSourceNode | null;
  private playbacks = new Set<{
    source: AudioBufferSourceNode;
    gain: GainNode;
  }>();

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

  public get duration(): number {
    return this.buffer.duration;
  }

  /** Routes future playbacks through a shared bus, used for independent music volume. */
  public setOutput(output: AudioDestinationNode | GainNode) {
    this.output = output;
  }

  /** Every track loops natively; a shared future start time keeps the stems aligned. */
  public play(
    volume: number,
    offsetSeconds: number,
    when: number,
    fadeSeconds: number,
  ) {
    const offset = Math.max(0, offsetSeconds) % this.buffer.duration;
    const gain = this.context.createGain();
    this.gain = gain;
    gain.connect(this.output);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(volume, when + fadeSeconds);
    const source = this.context.createBufferSource();
    this.source = source;
    source.buffer = this.buffer;
    source.loop = true;
    const playback = { source, gain };
    this.playbacks.add(playback);
    source.connect(gain);
    source.onended = () => {
      this.playbacks.delete(playback);
      source.disconnect();
      gain.disconnect();
    };
    source.start(when, offset);
  }

  /** Retarget an in-flight fade from its audible level rather than queueing competing ramps. */
  public fadeTo(volume: number, seconds: number) {
    if (!this.gain) {
      return;
    }
    this.fadeGain(this.gain, volume, seconds);
  }

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

  public fadeOut(seconds = MUSIC_FADE_SECONDS) {
    if (!this.gain || !this.source) return;
    this.fadeGain(this.gain, 0, seconds);
    this.source.stop(this.context.currentTime + seconds);
    this.gain = null;
    this.source = null;
  }

  /** Also silence outgoing crossfades, including an older copy of this same track. */
  public stopAll(seconds: number) {
    for (const { source, gain } of this.playbacks) {
      this.fadeGain(gain, 0, seconds);
      source.stop(this.context.currentTime + seconds);
    }
    this.gain = null;
    this.source = null;
  }
}
