export type SoundEffectType =
  | "BLACKOUT"
  | "POWER_RESTORED"
  | "BUILD_COMMITTED"
  | "CONSTRUCTION_COMPLETE"
  | "VICTORY"
  | "FAILURE";

interface Note {
  frequency: number;
  at: number;
  duration: number;
  volume: number;
  type?: OscillatorType;
  endFrequency?: number;
}

const MIN_GAIN = 0.0001;

/**
 * Small synthesized cues rather than six more files to download before the game can start.
 *
 * They deliberately stay short and tonal: the score is already layered music, and effects here
 * communicate a state transition rather than trying to reproduce a whole power station. Every
 * oscillator gets its own envelope and stops itself, so no cue leaves a node running after it.
 */
export class SoundEffects {
  private readonly context: AudioContext;
  private readonly output: GainNode;
  private paused = false;
  private volume = 1;

  constructor(context: AudioContext) {
    this.context = context;
    this.output = context.createGain();
    this.output.connect(context.destination);
    this.setVolume(1);
  }

  public setVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyVolume();
  }

  public pause() {
    this.paused = true;
    // The master switch and page visibility both come through here. Silence a cue already in
    // flight as well as preventing the next one.
    this.applyVolume();
  }

  public resume() {
    this.paused = false;
    this.applyVolume();
  }

  public play(effect: SoundEffectType) {
    if (this.paused || this.volume === 0) {
      return;
    }
    // A cue follows a player action often enough to unlock a suspended mobile AudioContext. For
    // automatic cues, resume() is harmless and lets the next gesture restore the context.
    if (this.context.state === "suspended") {
      void this.context.resume().then(() => {
        if (!this.paused && this.volume > 0) {
          this.schedule(effect);
        }
      });
      return;
    }
    this.schedule(effect);
  }

  private applyVolume() {
    this.output.gain.setValueAtTime(
      this.paused ? 0 : this.volume,
      this.context.currentTime,
    );
  }

  private schedule(effect: SoundEffectType) {
    const notes: Record<SoundEffectType, Note[]> = {
      // A breaker opening: low, rough and descending, but over before it becomes an alarm loop.
      BLACKOUT: [
        {
          frequency: 130,
          endFrequency: 58,
          at: 0,
          duration: 0.48,
          volume: 0.34,
          type: "sawtooth",
        },
        {
          frequency: 82,
          endFrequency: 54,
          at: 0.12,
          duration: 0.42,
          volume: 0.22,
          type: "square",
        },
      ],
      // Relay close, then an upward confirmation that the grid is carrying demand again.
      POWER_RESTORED: [
        { frequency: 185, at: 0, duration: 0.08, volume: 0.2, type: "square" },
        { frequency: 330, at: 0.08, duration: 0.16, volume: 0.18 },
        { frequency: 494, at: 0.2, duration: 0.22, volume: 0.2 },
        { frequency: 659, at: 0.32, duration: 0.3, volume: 0.2 },
      ],
      // A restrained contractual/industrial thunk when money is committed.
      BUILD_COMMITTED: [
        {
          frequency: 105,
          endFrequency: 72,
          at: 0,
          duration: 0.16,
          volume: 0.34,
          type: "triangle",
        },
        {
          frequency: 210,
          at: 0.04,
          duration: 0.1,
          volume: 0.16,
          type: "square",
        },
      ],
      // Machinery catching, followed by a compact positive flourish.
      CONSTRUCTION_COMPLETE: [
        { frequency: 165, at: 0, duration: 0.12, volume: 0.2, type: "square" },
        { frequency: 262, at: 0.08, duration: 0.18, volume: 0.18 },
        { frequency: 392, at: 0.2, duration: 0.2, volume: 0.2 },
        { frequency: 523, at: 0.32, duration: 0.28, volume: 0.2 },
      ],
      // C-major arpeggio, long enough to mark the end of a run without replacing the music.
      VICTORY: [
        {
          frequency: 523,
          at: 0,
          duration: 0.25,
          volume: 0.18,
          type: "triangle",
        },
        {
          frequency: 659,
          at: 0.16,
          duration: 0.25,
          volume: 0.18,
          type: "triangle",
        },
        {
          frequency: 784,
          at: 0.32,
          duration: 0.25,
          volume: 0.2,
          type: "triangle",
        },
        {
          frequency: 1047,
          at: 0.48,
          duration: 0.5,
          volume: 0.22,
          type: "triangle",
        },
      ],
      // The same tonal vocabulary pointed down: serious, short, and not punitive.
      FAILURE: [
        {
          frequency: 392,
          at: 0,
          duration: 0.24,
          volume: 0.2,
          type: "triangle",
        },
        {
          frequency: 311,
          at: 0.16,
          duration: 0.26,
          volume: 0.2,
          type: "triangle",
        },
        {
          frequency: 233,
          at: 0.32,
          duration: 0.3,
          volume: 0.22,
          type: "triangle",
        },
        {
          frequency: 175,
          at: 0.5,
          duration: 0.48,
          volume: 0.24,
          type: "sawtooth",
        },
      ],
    };

    const now = this.context.currentTime;
    notes[effect].forEach((note: Note) => this.playNote(note, now));
  }

  private playNote(note: Note, cueStartedAt: number) {
    const start = cueStartedAt + note.at;
    const end = start + note.duration;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();

    oscillator.type = note.type || "sine";
    oscillator.frequency.setValueAtTime(note.frequency, start);
    if (note.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(note.endFrequency, end);
    }

    envelope.gain.setValueAtTime(MIN_GAIN, start);
    envelope.gain.exponentialRampToValueAtTime(note.volume, start + 0.015);
    envelope.gain.exponentialRampToValueAtTime(MIN_GAIN, end);
    oscillator.connect(envelope);
    envelope.connect(this.output);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }
}
