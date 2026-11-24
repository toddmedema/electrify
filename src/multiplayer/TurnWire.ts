import type { WireMessage } from "./SessionTransport";
import { decodeWire, encodeWire } from "./WireJson";

const FRAME_BYTES = 16 * 1024;
const HEADER_BYTES = 3;
const BODY_BYTES = FRAME_BYTES - HEADER_BYTES;
const MESSAGE_BYTES = 4 * BODY_BYTES;
const ASSEMBLY_MS = 2_000;
const FRAME_INTERVAL_MS = 5_000;
const MAX_INTERVAL_FRAMES = 512;
const MAX_INTERVAL_BYTES = 1024 * 1024;
const VERSION = 2;
const IDENTIFIER = /^[\w-]{1,128}$/;
const HASH = /^[\da-f]{64}$/i;

export type TransferKind = "scenario" | "baseline";
export type TurnTransfer = {
  kind: "transfer";
  type: TransferKind;
  reference: string;
};

type Packet = {
  epoch: string;
  generation: string;
  message: WireMessage | TurnTransfer;
};

type ObjectValue = Record<string, unknown>;
function object(value: unknown): value is ObjectValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exact(value: ObjectValue, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function id(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}
function number(value: unknown, minimum = 0): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}
function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}
function names(value: unknown, limit = 4): value is string[] {
  return Array.isArray(value) && value.length <= limit && value.every(id);
}

function command(value: unknown, epoch: string) {
  if (
    !object(value) ||
    !exact(value, ["matchId", "epoch", "sequence", "command"]) ||
    !id(value.matchId) ||
    value.epoch !== epoch ||
    !number(value.sequence, 1) ||
    !object(value.command)
  ) {
    return false;
  }
  const data = value.command;
  switch (data.kind) {
    case "pause":
    case "ready":
      return exact(data, ["kind"]);
    case "speed":
      return (
        exact(data, ["kind", "speed"]) &&
        ["PAUSED", "SLOW", "NORMAL", "FAST", "ULTRA"].includes(
          data.speed as string,
        )
      );
    case "activity":
      return (
        exact(data, ["kind", "reason"]) &&
        (data.reason === null || text(data.reason, 160))
      );
    case "rate":
      return (
        exact(data, ["kind", "value"]) &&
        typeof data.value === "number" &&
        Number.isFinite(data.value)
      );
    case "action": {
      if (!exact(data, ["kind", "name", "payload"]) || !text(data.name, 160))
        return false;
      // A recorded command also carries its seat, receipt, record and packet headers.
      const json = encodeWire(value);
      return (
        new TextEncoder().encode(json).byteLength <= 56 * 1024 &&
        fitsJsonShape(json, 40, 8000)
      );
    }
    default:
      return false;
  }
}

function liveMessage(value: ObjectValue, epoch: string) {
  return id(value.matchId) && value.epoch === epoch;
}

export function validTurnPayload(
  value: unknown,
  senderIsHost: boolean,
  epoch: string,
): value is WireMessage | TurnTransfer {
  if (!object(value)) return false;
  switch (value.kind) {
    case "heartbeat":
      return exact(value, ["kind"]);
    case "command":
      return (
        !senderIsHost &&
        exact(value, ["kind", "envelope"]) &&
        command(value.envelope, epoch)
      );
    case "progress":
      return (
        !senderIsHost &&
        exact(value, ["kind", "matchId", "epoch", "applied", "verified"]) &&
        liveMessage(value, epoch) &&
        number(value.applied) &&
        (value.verified === undefined ||
          (object(value.verified) &&
            exact(value.verified, ["index", "hash"]) &&
            number(value.verified.index) &&
            typeof value.verified.hash === "string" &&
            HASH.test(value.verified.hash)))
      );
    case "resync":
      return (
        !senderIsHost &&
        exact(value, ["kind", "matchId", "epoch", "applied", "reason"]) &&
        liveMessage(value, epoch) &&
        number(value.applied) &&
        text(value.reason, 512)
      );
    case "save-request":
      return (
        !senderIsHost &&
        exact(value, ["kind", "requestId", "suspended", "pause"]) &&
        id(value.requestId) &&
        (value.suspended === undefined ||
          typeof value.suspended === "boolean") &&
        (value.pause === undefined || typeof value.pause === "boolean")
      );
    case "keepalive":
      return (
        senderIsHost &&
        exact(value, [
          "kind",
          "matchId",
          "epoch",
          "revision",
          "disconnected",
        ]) &&
        liveMessage(value, epoch) &&
        number(value.revision) &&
        (value.disconnected === undefined || names(value.disconnected))
      );
    case "records":
      return (
        senderIsHost &&
        exact(value, ["kind", "matchId", "epoch", "from", "records"]) &&
        liveMessage(value, epoch) &&
        number(value.from) &&
        Array.isArray(value.records) &&
        value.records.length > 0 &&
        value.records.length <= 1024
      );
    case "rejected":
      return (
        senderIsHost &&
        exact(value, ["kind", "matchId", "epoch", "sequence", "error"]) &&
        liveMessage(value, epoch) &&
        number(value.sequence, 1) &&
        text(value.error, 1024)
      );
    case "save-result":
      return (
        senderIsHost &&
        exact(value, ["kind", "requestId", "error"]) &&
        id(value.requestId) &&
        (value.error === undefined || text(value.error, 1024))
      );
    case "browse":
      return (
        senderIsHost && exact(value, ["kind", "browse"]) && object(value.browse)
      );
    case "campaign":
      return (
        senderIsHost &&
        exact(value, ["kind", "campaign"]) &&
        (value.campaign === undefined || object(value.campaign))
      );
    case "transfer":
      return (
        senderIsHost &&
        exact(value, ["kind", "type", "reference"]) &&
        (value.type === "baseline" || value.type === "scenario") &&
        id(value.reference)
      );
    default:
      return false;
  }
}

export function validTurnTransfer(
  value: unknown,
  type: TransferKind,
  epoch: string,
): value is WireMessage {
  if (!object(value) || value.kind !== type) return false;
  if (type === "scenario")
    return (
      exact(value, ["kind", "selectionKey", "scenario"]) &&
      text(value.selectionKey, 1024) &&
      object(value.scenario)
    );
  return (
    exact(value, ["kind", "matchId", "epoch", "index", "world", "blockers"]) &&
    liveMessage(value, epoch) &&
    number(value.index) &&
    object(value.world) &&
    value.world.epoch === epoch &&
    value.world.matchId === value.matchId &&
    Array.isArray(value.blockers) &&
    value.blockers.length <= 32 &&
    value.blockers.every((reason) => text(reason, 512))
  );
}

export function turnFrames(packet: Packet): Uint8Array<ArrayBuffer>[] {
  const payload = new TextEncoder().encode(encodeWire(packet));
  if (payload.byteLength > MESSAGE_BYTES)
    throw new Error("Multiplayer message is too large");
  const count = Math.ceil(payload.byteLength / BODY_BYTES);
  return Array.from({ length: count }, (_, index) => {
    const payloadSlice = payload.subarray(
      index * BODY_BYTES,
      (index + 1) * BODY_BYTES,
    );
    const frame = new Uint8Array(HEADER_BYTES + payloadSlice.length);
    frame.set([VERSION, index, count]);
    frame.set(payloadSlice, HEADER_BYTES);
    return frame;
  });
}

/** Bound reviver recursion and visited object values before parsing untrusted JSON. */
export function fitsJsonShape(
  source: string,
  maxDepth: number,
  maxItems: number,
) {
  let depth = 0;
  let elements = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted && character === "\\") {
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted) {
      if (character === "{" || character === "[") {
        if (++depth > maxDepth) return false;
        elements += 1;
      } else if (character === "}" || character === "]") {
        depth -= 1;
      } else if (character === ",") {
        elements += 1;
      }
      if (elements > maxItems) return false;
    }
  }
  return true;
}

/** An ordered channel permits one bounded assembly, with no cross-generation carryover. */
export class TurnFrameReader {
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private startedInterval = 0;
  private intervalFrames = 0;
  private intervalBytes = 0;
  private buffer?: Uint8Array<ArrayBuffer>;
  private started = 0;
  private count = 0;
  private index = 0;

  read(
    frame: unknown,
    at: number,
    generation: string,
    epoch: string,
    senderIsHost: boolean,
  ) {
    if (
      !(frame instanceof ArrayBuffer) ||
      frame.byteLength <= HEADER_BYTES ||
      frame.byteLength > FRAME_BYTES
    ) {
      throw new Error("Invalid multiplayer frame");
    }
    if (at - this.startedInterval >= FRAME_INTERVAL_MS) {
      this.startedInterval = at;
      this.intervalBytes = 0;
      this.intervalFrames = 0;
    }
    this.intervalBytes += frame.byteLength;
    if (
      ++this.intervalFrames > MAX_INTERVAL_FRAMES ||
      this.intervalBytes > MAX_INTERVAL_BYTES
    ) {
      throw new Error("Multiplayer input exceeded its rate limit");
    }
    const bytes = new Uint8Array(frame);
    const [version, index, count] = bytes;
    if (
      version !== VERSION ||
      count < 1 ||
      count > 4 ||
      index !== this.index ||
      index >= count ||
      (index < count - 1 && frame.byteLength !== FRAME_BYTES)
    ) {
      throw new Error("Invalid multiplayer fragment");
    }
    if (index === 0) {
      this.started = at;
      this.count = count;
      this.buffer = new Uint8Array(BODY_BYTES * count);
    }
    if (!this.buffer || count !== this.count || at - this.started > ASSEMBLY_MS)
      throw new Error("Obsolete multiplayer fragments");
    const offset = BODY_BYTES * index;
    this.buffer.set(bytes.subarray(HEADER_BYTES), offset);
    this.index += 1;
    if (this.index < count) return undefined;

    const assembled = this.buffer.subarray(
      0,
      offset + frame.byteLength - HEADER_BYTES,
    );
    this.buffer = undefined;
    this.index = 0;
    const source = this.decoder.decode(assembled);
    if (!fitsJsonShape(source, 48, 8192))
      throw new Error("Multiplayer message exceeds structural limits");
    const packet = decodeWire(source);
    if (
      !object(packet) ||
      !exact(packet, ["epoch", "generation", "message"]) ||
      packet.generation !== generation ||
      packet.epoch !== epoch ||
      !validTurnPayload(packet.message, senderIsHost, epoch)
    ) {
      throw new Error("Invalid multiplayer message");
    }
    return { message: packet.message, bytes: assembled.byteLength };
  }
}
