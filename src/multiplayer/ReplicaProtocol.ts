import type { ScenarioType } from "../Types";
import type { RoomView } from "./Types";
import type { ReplicaBaseline, ReplicaRecord } from "./Replication";

export interface ReplicaProgress {
  matchId: string;
  epoch: string;
  applied: number;
  verified?: { index: number; hash: string };
}
export type HostReplicationRequest =
  | (ReplicaProgress & { kind: "progress"; sender: string })
  | (Omit<ReplicaProgress, "verified"> & {
      kind: "resync";
      sender: string;
      reason: string;
    });
export type ReplicaRequest =
  | {
      kind: "baseline";
      baseline: ReplicaBaseline;
      seat: string;
      /** A detached scenario already validated and pinned by the guest shell. */
      scenario?: ScenarioType;
    }
  | {
      kind: "records";
      matchId: string;
      epoch: string;
      from: number;
      records: ReplicaRecord[];
    }
  | { kind: "views-applied" };
export type ReplicaResponse =
  | { kind: "views"; views: Record<string, RoomView> }
  | (ReplicaProgress & {
      kind: "progress";
      state: "waiting" | "live" | "stopped";
      error?: string;
    })
  | (Omit<ReplicaProgress, "verified"> & { kind: "resync"; reason: string });
