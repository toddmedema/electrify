import type { MapInstance } from "./Types";

export const MOTION_CYCLE = Math.PI * 2;
const RETAINED_PHASES = 256;
interface Phase {
  value: number;
  active: boolean;
  present: boolean;
}

/** One clock for actual facility identities, independent of model/batch/speed. */
export class FacilityMotionClock {
  private phases = new Map<string, Phase>();
  private timestamp: number | undefined;

  sync(instances: readonly MapInstance[]): void {
    for (const phase of this.phases.values()) {
      phase.active = false;
      phase.present = false;
    }
    for (const instance of instances) {
      if (!instance.model.parts.some((part) => part.motion)) continue;
      const key = instance.motionKey ?? instance.id;
      const phase = this.phases.get(key) ?? {
        value: 0,
        active: false,
        present: true,
      };
      phase.active ||= instance.active;
      phase.present = true;
      // Refresh insertion order for a bounded least-recently-visible tail.
      this.phases.delete(key);
      this.phases.set(key, phase);
    }
    let retained = 0;
    for (const phase of this.phases.values()) if (!phase.present) retained++;
    for (const [key, phase] of this.phases) {
      if (retained <= RETAINED_PHASES) break;
      if (!phase.present) {
        this.phases.delete(key);
        retained--;
      }
    }
  }

  tick(timestamp: number, allowed: boolean, rate: number): void {
    if (!allowed) {
      this.resetTimestamp();
      return;
    }
    const delta =
      this.timestamp === undefined
        ? 0
        : Math.max(0, timestamp - this.timestamp);
    this.timestamp = timestamp;
    const advance =
      (delta * Math.max(0, Number.isFinite(rate) ? rate : 0) * MOTION_CYCLE) /
      8000;
    for (const phase of this.phases.values())
      if (phase.active) phase.value = (phase.value + advance) % MOTION_CYCLE;
  }

  get moving(): boolean {
    for (const phase of this.phases.values()) if (phase.active) return true;
    return false;
  }

  phase(key: string): number {
    return this.phases.get(key)?.value ?? 0;
  }

  resetTimestamp(): void {
    this.timestamp = undefined;
  }

  snapshot(): Readonly<Record<string, number>> {
    const values: Record<string, number> = Object.create(null);
    for (const [key, phase] of this.phases) values[key] = phase.value;
    return Object.freeze(values);
  }
}
