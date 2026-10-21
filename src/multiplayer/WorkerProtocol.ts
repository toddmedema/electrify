import type {
  CommandEnvelope,
  MatchSpec,
  RoomView,
  Seat,
  World,
} from "./Types";
export type WorkerRequest =
  | { kind: "heartbeat" }
  | {
      kind: "create";
      spec: MatchSpec;
      seats: Seat[];
      matchId: string;
      epoch: string;
    }
  /** seats hands each saved company, in saved order, to the player resuming it. */
  | { kind: "restore"; world: unknown; epoch: string; seats?: Seat[] }
  | {
      kind: "command";
      sender: string;
      envelope: CommandEnvelope;
      allowReady?: boolean;
    }
  | { kind: "disconnect"; sender: string }
  | { kind: "checkpoint"; requestId?: string; pause?: boolean };
export type WorkerResponse =
  | { kind: "views"; views: Record<string, RoomView> }
  | { kind: "keepalive"; matchId: string; epoch: string; revision: number }
  | { kind: "checkpoint"; world: World; requestId?: string }
  | { kind: "error"; message: string };
