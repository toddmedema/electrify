import type {
  CommandEnvelope,
  MatchSpec,
  RoomView,
  Seat,
  World,
} from "./Types";
export type WorkerRequest =
  | { kind: "heartbeat" }
  /** The shell consumed the previous view bundle; allow the newest projection to follow. */
  | { kind: "views-applied" }
  | {
      kind: "create";
      local?: boolean;
      spec: MatchSpec;
      seats: Seat[];
      matchId: string;
      epoch: string;
    }
  /** seats hands each saved company, in saved order, to the player resuming it. */
  | {
      kind: "restore";
      world: unknown;
      epoch: string;
      seats?: Seat[];
      local?: boolean;
    }
  | {
      kind: "command";
      sender: string;
      envelope: CommandEnvelope;
      allowReady?: boolean;
    }
  | { kind: "disconnect"; sender: string }
  /** Shell-only lifecycle state; never exposed through a seat port. */
  | {
      kind: "blockers";
      reasons: string[];
      requireReady?: boolean;
      readyReason?: string;
    }
  | {
      kind: "checkpoint";
      requestId?: string;
      pause?: boolean;
      suspended?: boolean;
    };
export type WorkerResponse =
  | { kind: "summary"; summary: import("../couch/Protocol").CouchSummary }
  | { kind: "views"; views: Record<string, RoomView> }
  | { kind: "keepalive"; matchId: string; epoch: string; revision: number }
  | { kind: "checkpoint"; world: World; requestId?: string }
  | { kind: "error"; message: string };
