import cloneDeep from "lodash.clonedeep";
import type { CommandEnvelope, World } from "./Types";
import {
  applyCommand,
  checkpointWorld,
  hydrateWorld,
  pauseWorld,
  RULES,
  setWorldBlockers,
  stepWorld,
  worldBlockers,
} from "./World";

export type ReplicaRecord =
  | {
      t: "command";
      seat: string;
      envelope: CommandEnvelope;
      allowReady: boolean;
      error?: string;
      revision: number;
    }
  | { t: "step"; n: number; revision: number }
  | { t: "pause"; reason: string }
  | { t: "blockers"; reasons: string[] }
  | { t: "verify" }
  | { t: "fault"; message: string };

export interface ReplicaBaseline {
  matchId: string;
  epoch: string;
  index: number;
  world: World;
  blockers: string[];
}
export interface ReplicaBatch {
  from: number;
  records: ReplicaRecord[];
}
export class ReplicaMismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplicaMismatch";
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, minimum: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** The worker also validates records received through a mock or future transport. */
export function validReplicaRecord(value: unknown): value is ReplicaRecord {
  if (!object(value)) return false;
  switch (value.t) {
    case "command":
      return (
        typeof value.seat === "string" &&
        object(value.envelope) &&
        typeof value.envelope.matchId === "string" &&
        typeof value.envelope.epoch === "string" &&
        integer(value.envelope.sequence, 1) &&
        typeof value.allowReady === "boolean" &&
        (value.error === undefined || typeof value.error === "string") &&
        integer(value.revision, 1)
      );
    case "step":
      return (
        integer(value.n, 1) && value.n <= 10000 && integer(value.revision, 1)
      );
    case "pause":
      return typeof value.reason === "string";
    case "blockers":
      return strings(value.reasons);
    case "verify":
      return true;
    case "fault":
      return typeof value.message === "string";
    default:
      return false;
  }
}

/** Replay the host's transition using the same authoritative command and tick APIs. */
export function applyRecord(world: World, record: ReplicaRecord): void {
  if (!validReplicaRecord(record))
    throw new ReplicaMismatch("Invalid replica record");
  switch (record.t) {
    case "command": {
      const previous = world.sequences[record.seat] || 0;
      const error = applyCommand(
        world,
        record.seat,
        record.envelope,
        record.allowReady,
      );
      if (
        (world.sequences[record.seat] || 0) !== previous + 1 ||
        error !== record.error ||
        world.revision !== record.revision
      )
        throw new ReplicaMismatch("Command result differs from the host");
      break;
    }
    case "step":
      for (let n = 0; n < record.n; n++) {
        const revision = world.revision;
        stepWorld(world);
        if (world.revision !== revision + 1)
          throw new ReplicaMismatch("A replica step did not advance time");
      }
      if (world.revision !== record.revision)
        throw new ReplicaMismatch("Step revision differs from the host");
      break;
    case "pause":
      pauseWorld(world, record.reason);
      break;
    case "blockers":
      setWorldBlockers(world, record.reasons);
      break;
    case "verify":
    case "fault":
      // A fault may follow a partially applied simulation tick. It is terminal, never hashed.
      break;
  }
}

/** Authoritative transition recorder. Draining drops records; recovery always uses a baseline. */
export class ReplicatedWorld {
  private pending: ReplicaRecord[] = [];
  private next = 1;
  private times: { index: number; time: number }[] = [];
  private terminal = false;
  constructor(
    readonly world: World,
    private now: () => number = () => performance.now(),
  ) {}
  get index() {
    return this.next - 1;
  }
  private append(record: ReplicaRecord) {
    if (this.terminal)
      throw new ReplicaMismatch("The replicated world has stopped");
    const time = this.now();
    this.times = this.times.filter((entry) => time - entry.time <= 30000);
    this.times.push({ index: this.next++, time });
    this.pending.push(record);
  }
  /** First append time for lag accounting; no state-transition history is retained. */
  appendedAt(index: number): number | undefined {
    return this.times.find((entry) => entry.index === index)?.time;
  }
  command(seat: string, envelope: CommandEnvelope, allowReady = true) {
    if (this.terminal)
      throw new ReplicaMismatch("The replicated world has stopped");
    const previous = this.world.sequences?.[seat] || 0;
    const error = applyCommand(this.world, seat, envelope, allowReady);
    const recorded = (this.world.sequences?.[seat] || 0) > previous;
    if (recorded)
      this.append({
        t: "command",
        seat,
        envelope: cloneDeep(envelope),
        allowReady,
        error,
        revision: this.world.revision,
      });
    return { error, recorded };
  }
  step(): boolean {
    if (this.terminal)
      throw new ReplicaMismatch("The replicated world has stopped");
    const previous = this.world.revision;
    stepWorld(this.world);
    if (previous === this.world.revision) return false;
    const last = this.pending[this.pending.length - 1];
    if (last?.t === "step" && last.n < 10000) {
      last.n++;
      last.revision = this.world.revision;
    } else this.append({ t: "step", n: 1, revision: this.world.revision });
    return true;
  }
  pause(reason: string) {
    if (this.terminal)
      throw new ReplicaMismatch("The replicated world has stopped");
    applyRecord(this.world, { t: "pause", reason });
    this.append({ t: "pause", reason });
  }
  setBlockers(shell: string[], host: string[] = []) {
    if (this.terminal)
      throw new ReplicaMismatch("The replicated world has stopped");
    const reasons = [...shell, ...host];
    applyRecord(this.world, { t: "blockers", reasons });
    this.append({ t: "blockers", reasons });
  }
  fault(message: string) {
    this.append({ t: "fault", message });
    this.terminal = true;
  }
  verify() {
    this.append({ t: "verify" });
  }
  /** Capture before appending verify. Callers flush prior records before sending this snapshot. */
  baseline(): ReplicaBaseline {
    if (this.terminal)
      throw new ReplicaMismatch("The replicated world has stopped");
    const baseline = {
      matchId: this.world.matchId,
      epoch: this.world.epoch,
      index: this.index,
      world: cloneDeep(checkpointWorld(this.world)),
      blockers: worldBlockers(this.world),
    };
    this.verify();
    return baseline;
  }
  drain(): ReplicaBatch | undefined {
    if (!this.pending.length) return;
    const batch = {
      from: this.next - this.pending.length,
      records: this.pending,
    };
    this.pending = [];
    return batch;
  }
}

/** A baseline is validated in isolation before it replaces the last usable replica. */
export class Replica {
  private current?: World;
  private index = 0;
  private terminal = false;
  get world(): World {
    if (!this.current)
      throw new ReplicaMismatch("A replica baseline is required");
    return this.current;
  }
  get applied() {
    return this.index;
  }
  get stopped() {
    return this.terminal;
  }
  install(baseline: ReplicaBaseline): void {
    if (
      !object(baseline) ||
      !integer(baseline.index, 0) ||
      typeof baseline.matchId !== "string" ||
      typeof baseline.epoch !== "string" ||
      !strings(baseline.blockers)
    )
      throw new ReplicaMismatch("Invalid replica baseline");
    if (baseline.world?.rules !== RULES)
      throw new ReplicaMismatch("The host uses different multiplayer rules");
    const world = hydrateWorld(baseline.world);
    if (world.matchId !== baseline.matchId || world.epoch !== baseline.epoch)
      throw new ReplicaMismatch("Baseline belongs to another session");
    setWorldBlockers(world, baseline.blockers);
    this.current = world;
    this.index = baseline.index;
    this.terminal = false;
  }
  /** Hashing callers split batches at each verify and capture bytes before replaying later records. */
  apply(from: number, records: ReplicaRecord[]): number[] {
    if (!this.current || this.terminal)
      throw new ReplicaMismatch("The replica is not live");
    if (!integer(from, 1) || from !== this.index + 1)
      throw new ReplicaMismatch("A replica record is missing or duplicated");
    if (
      !Array.isArray(records) ||
      !records.length ||
      !records.every(validReplicaRecord)
    )
      throw new ReplicaMismatch("Invalid replica records");
    const verified: number[] = [];
    for (const record of records) {
      if (this.terminal)
        throw new ReplicaMismatch("Records follow a terminal fault");
      applyRecord(this.current, record);
      this.index++;
      if (record.t === "verify") verified.push(this.index);
      if (record.t === "fault") this.terminal = true;
    }
    return verified;
  }
}

/** Type-tagged canonical encoding avoids collisions between special values and authored objects.
 * Object undefined is omitted, array undefined (including holes) is retained, and keys are sorted. */
function canonical(value: unknown): string {
  if (value === undefined) return "u";
  if (value === null) return "null";
  if (typeof value === "number")
    return Object.is(value, -0)
      ? "n-0"
      : Number.isNaN(value)
        ? "nNaN"
        : `n${value}`;
  if (typeof value === "string") return `s${JSON.stringify(value)}`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value))
    return `[${Array.from(value, (item) => canonical(item)).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  throw new TypeError("Unsupported value in replica state");
}
export function canonicalWorldBytes(world: World): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    canonical({
      world: checkpointWorld(world),
      blockers: worldBlockers(world),
    }),
  );
}
export type DigestFunction = (
  bytes: Uint8Array<ArrayBuffer>,
) => Promise<ArrayBuffer>;
/** WebCrypto avoids the allocation-heavy JavaScript SHA implementation used for small rule IDs. */
export async function worldDigest(
  bytes: Uint8Array<ArrayBuffer>,
  digest: DigestFunction = (value) =>
    crypto.subtle.digest("SHA-256", value as BufferSource),
): Promise<string> {
  const result = await digest(bytes);
  return Array.from(new Uint8Array(result), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
