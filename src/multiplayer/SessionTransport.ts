import type { ScenarioType } from "../Types";
import type { BrowseState } from "./Browse";
import type { CommandEnvelope, Seat, World } from "./Types";
import type { ReplicaBaseline, ReplicaRecord } from "./Replication";
import type { ReplicaProgress } from "./ReplicaProtocol";
/** A lobby member, with the selection they last marked Ready for (see selectionKey). */
export interface LobbyMember extends Seat {
  ready?: string;
  /** The saved company this member claimed while resuming (see slotClaim). */
  slot?: string;
}
export interface LobbyState {
  inviteLobbyId?: string;
  available: boolean;
  lobbyId?: string;
  inviteCode?: string;
  inviteToken?: string;
  inviteExpiresAt?: number;
  inviteVersion?: string;
  campaignLocked?: boolean;
  requiredPlayers?: string[];
  recoveryAvailable?: boolean;
  authorityEpoch?: string;
  hostId?: string;
  selfId?: string;
  members: LobbyMember[];
  connected: string[];
  savedAt?: number | null;
  sharedAt?: number | null;
  confirmedRevision?: number;
  error?: string;
}
export interface SharedSaveLibrary {
  warning?: string;
  slots: {
    id: string;
    name: string;
    updatedAt: number;
    matchId: string;
    schema: number;
    players: string[];
  }[];
  cloudState: "disabled" | "offline" | "ready" | "failed";
}
export interface PendingCampaign {
  id: string;
  name: string;
  players: Seat[];
  requiredPlayerIds: string[];
}
export type WireMessage =
  | { kind: "heartbeat" }
  | {
      kind: "keepalive";
      matchId: string;
      epoch: string;
      revision: number;
      disconnected?: string[];
    }
  | ({ kind: "baseline" } & ReplicaBaseline)
  | {
      kind: "records";
      matchId: string;
      epoch: string;
      from: number;
      records: ReplicaRecord[];
    }
  | {
      kind: "rejected";
      matchId: string;
      epoch: string;
      sequence: number;
      error: string;
    }
  | ({ kind: "progress" } & ReplicaProgress)
  | {
      kind: "resync";
      matchId: string;
      epoch: string;
      applied: number;
      reason: string;
    }
  | {
      kind: "save-request";
      requestId: string;
      suspended?: boolean;
      pause?: boolean;
    }
  | { kind: "save-result"; requestId: string; error?: string }
  | { kind: "command"; envelope: CommandEnvelope }
  | { kind: "browse"; browse: BrowseState }
  | { kind: "scenario"; selectionKey: string; scenario: ScenarioType }
  | { kind: "campaign"; campaign?: PendingCampaign };
export type SessionRequest =
  | {
      kind: "state" | "leave" | "restart-host";
    }
  /** `finished` sets a completed match's saved campaign aside, so its lobby can play on. */
  | { kind: "unlock"; finished?: true }
  | { kind: "reconnect"; roomId?: string }
  | { kind: "remove"; seatId: string }
  | { kind: "create"; rules: string }
  | { kind: "join"; rules: string; lobbyId: string }
  | { kind: "member"; key: "ready" | "slot"; value: string }
  | { kind: "lock"; ids: string[]; requiredIds: string[] }
  | { kind: "send"; to: string; payload: WireMessage };

export type SessionEvent =
  | { kind: "invite"; lobbyId: string }
  | { kind: "state"; state: LobbyState }
  | { kind: "message"; sender: string; payload: WireMessage }
  | { kind: "disconnected"; sender: string };

type LobbyRequest =
  | "state"
  | "create"
  | "join"
  | "leave"
  | "reconnect"
  | "member"
  | "unlock"
  | "remove"
  | "restart-host";

type SessionReplies = {
  [Kind in SessionRequest["kind"]]: Kind extends LobbyRequest
    ? LobbyState
    : void;
};

export type SessionReply<Request extends SessionRequest> =
  SessionReplies[Request["kind"]];

/** A peer connection ended before the transport could accept this send. */
export class PeerDisconnectedError extends Error {}

export interface SessionTransport {
  /** A successful send accepts the message into the peer's ordered queue. The receiver
   * acknowledges application separately. A disconnected send rejects with PeerDisconnectedError. */
  request<Request extends SessionRequest>(
    request: Request,
  ): Promise<SessionReply<Request>>;
  subscribe(listener: (event: SessionEvent) => void): () => void;
}

export interface CheckpointStore {
  read(id?: string): Promise<World | null>;
  list(sync: boolean): Promise<SharedSaveLibrary>;
  remove(id: string): Promise<SharedSaveLibrary>;
  export?(): Promise<void>;
  /** Supply the version read at startup when saving a restored world. */
  write(
    world: World,
    source?: Readonly<Pick<World, "matchId" | "epoch" | "revision">>,
    explicit?: boolean,
  ): Promise<void>;
}

export interface AuthorityWindow {
  epoch: string;
  monotonicDeadline: number;
  wallDeadline: number;
}

export interface SessionServices {
  transport: SessionTransport;
  checkpoints: CheckpointStore;
  authority?: () => AuthorityWindow | undefined;
  onlineCampaigns?: boolean;
}
