import type { ReplicaBaseline, ReplicaRecord } from "./Replication";
import type { HostReplicationRequest } from "./ReplicaProtocol";
import type {
  CommandEnvelope,
  MatchSpec,
  RoomView,
  Seat,
  World,
} from "./Types";
/** Couch play projects every seat locally; online play projects only the host's company. */
type WorkerMode =
  { local: true; hostSeat?: never } | { local?: false; hostSeat: string };
export type WorkerRequest =
  | HostReplicationRequest
  | { kind: "replica-peers"; connected: string[] }
  | { kind: "heartbeat" }
  /** The shell consumed the previous view bundle; allow the newest projection to follow. */
  | { kind: "views-applied" }
  | (WorkerMode & {
      kind: "create";
      spec: MatchSpec;
      seats: Seat[];
      matchId: string;
      epoch: string;
    })
  /** seats hands each saved company, in saved order, to the player resuming it. */
  | (WorkerMode & {
      kind: "restore";
      world: unknown;
      epoch: string;
      seats?: Seat[];
    })
  | {
      kind: "command";
      sender: string;
      envelope: CommandEnvelope;
      allowReady?: boolean;
    }
  | { kind: "disconnect"; sender: string }
  | { kind: "baseline"; to: string }
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
  | {
      kind: "records";
      matchId: string;
      epoch: string;
      from: number;
      records: ReplicaRecord[];
    }
  | { kind: "baseline"; to: string; baseline: ReplicaBaseline }
  | {
      kind: "rejected";
      to: string;
      matchId: string;
      epoch: string;
      sequence: number;
      error: string;
    }
  | { kind: "summary"; summary: import("../couch/Protocol").CouchSummary }
  | { kind: "views"; views: Record<string, RoomView> }
  | { kind: "keepalive"; matchId: string; epoch: string; revision: number }
  | { kind: "checkpoint"; world: World; requestId?: string }
  | { kind: "error"; message: string };
