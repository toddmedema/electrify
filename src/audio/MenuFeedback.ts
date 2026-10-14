import { getAudioContext } from "../Globals";
import type { SettingsType } from "../Types";

export type MenuCue = "select" | "confirm" | "back";
type AudioPreferences = Pick<
  SettingsType,
  "audioEnabled" | "soundEffectsVolume"
>;

export function loadMenuBuffer(
  context: AudioContext,
  cue: MenuCue,
): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", `audio/menu/${cue}.wav`, true);
    request.responseType = "arraybuffer";
    request.onload = () => {
      if (request.status >= 400)
        reject(new Error("Menu audio is unavailable."));
      else void context.decodeAudioData(request.response).then(resolve, reject);
    };
    request.onerror = () => reject(new Error("Menu audio is unavailable."));
    request.send();
  });
}

/** Called only by gesture handlers; startup and automatic focus never start a cue. */
export class MenuFeedbackAudio {
  private context: AudioContext | null = null;
  private buffers?: Promise<Record<MenuCue, AudioBuffer>>;
  private sources = new Set<AudioBufferSourceNode>();
  private generation = 0;
  private lastAt: Partial<Record<MenuCue, number>> = {};

  constructor(
    private preferences: () => AudioPreferences,
    private foreground: () => boolean,
    private createContext = getAudioContext,
    private loadBuffer = loadMenuBuffer,
  ) {}

  private volume() {
    const settings = this.preferences();
    return settings.audioEnabled && Number.isFinite(settings.soundEffectsVolume)
      ? Math.max(0, Math.min(1, settings.soundEffectsVolume)) * 0.55
      : 0;
  }

  async play(cue: MenuCue): Promise<void> {
    if (!this.foreground() || !this.volume()) return;
    const now = Date.now();
    if (now - (this.lastAt[cue] ?? -Infinity) < 140) return;
    this.lastAt[cue] = now;
    const generation = ++this.generation;
    this.context ||= this.createContext();
    const context = this.context;
    if (!context || context.state === "closed") return;
    try {
      // Resume during the gesture, even when local decoding will finish a moment later.
      const resumed =
        context.state === "suspended" ? context.resume() : undefined;
      this.buffers ||= Promise.all(
        (["select", "confirm", "back"] as const).map(async (name) => [
          name,
          await this.loadBuffer(context, name),
        ]),
      ).then(
        (entries) =>
          Object.fromEntries(entries) as Record<MenuCue, AudioBuffer>,
      );
      const [buffers] = await Promise.all([this.buffers, resumed]);
      if (
        generation !== this.generation ||
        !this.foreground() ||
        !this.volume()
      )
        return;
      this.stopSources();
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffers[cue];
      gain.gain.setValueAtTime(this.volume(), context.currentTime);
      source.connect(gain);
      gain.connect(context.destination);
      source.onended = () => {
        this.sources.delete(source);
        source.disconnect();
        gain.disconnect();
      };
      this.sources.add(source);
      source.start();
    } catch {
      // Optional feedback must never interrupt navigation or retry after a lost gesture.
      this.buffers = undefined;
    }
  }

  private stopSources() {
    this.sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        /* A naturally ended source may already be stopped. */
      }
    });
    this.sources.clear();
  }

  stop() {
    ++this.generation;
    this.stopSources();
  }
}

export class ControllerFeedback {
  private actuators = new Set<GamepadHapticActuator>();
  private lastAt = -Infinity;

  constructor(
    private allowed: () => boolean,
    private getPads = () => navigator.getGamepads?.() || [],
  ) {}

  play(kind: "confirm" | "milestone") {
    if (!this.allowed() || Date.now() - this.lastAt < 180) return;
    try {
      const pad = Array.from(this.getPads()).find(
        (item) => item?.connected && item.vibrationActuator?.playEffect,
      );
      const actuator = pad?.vibrationActuator;
      if (!actuator) return;
      this.lastAt = Date.now();
      this.actuators.add(actuator);
      void actuator
        .playEffect("dual-rumble", {
          duration: kind === "confirm" ? 35 : 70,
          startDelay: 0,
          strongMagnitude: 0.12,
          weakMagnitude: 0.18,
        })
        .catch(() => this.actuators.delete(actuator));
    } catch {
      /* Unsupported actuators and disconnected controllers behave normally. */
    }
  }

  stop() {
    this.actuators.forEach((actuator) => {
      try {
        void actuator.reset().catch(() => undefined);
      } catch {
        /* Disconnect can remove the actuator before reset reaches the device. */
      }
    });
    this.actuators.clear();
  }
}
