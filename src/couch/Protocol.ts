import type { DateType, SpeedType } from "../Types";
import type { Command, RoomView, Seat, World } from "../multiplayer/Types";

/** Immutable campaign IDs. Device handles and account ownership never enter this namespace. */
export const localSeatId = (position: number) => `local-p${position + 1}`;
export const isLocalRoster = (seats: Seat[]) =>
  seats.length >= 2 &&
  seats.length <= 4 &&
  seats.every(
    (seat, i) =>
      seat.id === localSeatId(i) &&
      typeof seat.name === "string" &&
      !!seat.name.trim() &&
      seat.name.length <= 80,
  );

export interface CouchSummary {
  matchId: string;
  epoch: string;
  revision: number;
  date: DateType;
  speed: SpeedType;
  reason: string;
  readyRequired: boolean;
  ready: string[];
  players: (Seat & {
    selectedSpeed: SpeedType;
    pauseReason?: string;
    retired: boolean;
  })[];
  complete: boolean;
  outcomes: World["outcomes"];
}

/** Main authenticates the seat/generation outside this payload. No sender/control-worker API. */
export type SeatMessage =
  | { kind: "heartbeat" }
  | { kind: "ack"; delivery: number }
  | {
      kind: "command";
      command: Command;
      sequence: number;
      matchId: string;
      epoch: string;
    }
  | { kind: "leave"; requestId: string; skipSave?: boolean }
  | { kind: "global-settings"; requestId: string };
export type SeatEvent =
  | { kind: "view"; generation: number; delivery: number; view: RoomView }
  | { kind: "error"; generation: number; message: string }
  | {
      kind: "rejected";
      generation: number;
      sequence: number;
      lastSequence: number;
      matchId: string;
      epoch: string;
      message: string;
    }
  | { kind: "closing"; generation: number; closing: boolean }
  | {
      kind: "leave-result";
      generation: number;
      requestId: string;
      error?: string;
    }
  | { kind: "pulse"; generation: number };

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
/** Narrow the wire shape before it can reach the worker. Domain payloads are validated there. */
export function isSeatMessage(input: unknown): input is SeatMessage {
  if (!object(input)) return false;
  if (input.kind === "heartbeat") return Object.keys(input).length === 1;
  if (input.kind === "ack")
    return (
      Object.keys(input).length === 2 &&
      Number.isSafeInteger(input.delivery) &&
      Number(input.delivery) > 0
    );
  if (input.kind === "global-settings")
    return (
      Object.keys(input).length === 2 &&
      typeof input.requestId === "string" &&
      input.requestId.length > 0 &&
      input.requestId.length <= 100
    );
  if (input.kind === "leave")
    return (
      Object.keys(input).every((key) =>
        ["kind", "requestId", "skipSave"].includes(key),
      ) &&
      typeof input.requestId === "string" &&
      input.requestId.length > 0 &&
      input.requestId.length <= 100 &&
      (input.skipSave === undefined || typeof input.skipSave === "boolean")
    );
  return (
    input.kind === "command" &&
    Object.keys(input).every((key) =>
      ["kind", "command", "sequence", "matchId", "epoch"].includes(key),
    ) &&
    typeof input.matchId === "string" &&
    typeof input.epoch === "string" &&
    Number.isSafeInteger(input.sequence) &&
    Number(input.sequence) > 0 &&
    object(input.command) &&
    typeof input.command.kind === "string" &&
    ["pause", "ready", "speed", "activity", "action", "rate"].includes(
      input.command.kind,
    )
  );
}
