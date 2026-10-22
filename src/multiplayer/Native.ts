import type { ScenarioType } from "../Types";
import type { BrowseState } from "./Browse";
import type { CommandEnvelope, RoomView, Seat, World } from "./Types";
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
  hostId?: string;
  selfId?: string;
  members: LobbyMember[];
  connected: string[];
  savedAt?: number | null;
  sharedAt?: number | null;
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
  | { kind: "keepalive"; matchId: string; epoch: string; revision: number }
  | { kind: "view"; view: RoomView }
  | { kind: "save-request"; requestId: string }
  | { kind: "save-result"; requestId: string; error?: string }
  | { kind: "command"; envelope: CommandEnvelope }
  | { kind: "browse"; browse: BrowseState }
  | { kind: "scenario"; selectionKey: string; scenario: ScenarioType }
  | { kind: "campaign"; campaign?: PendingCampaign };
export type NativeRequest =
  | {
      kind: "state" | "leave" | "reconnect" | "invite" | "unlock";
    }
  | { kind: "read-checkpoint"; id?: string }
  | { kind: "list-saves"; sync?: boolean }
  | { kind: "delete-save"; id: string }
  | { kind: "create"; rules: string }
  | { kind: "join"; rules: string; lobbyId: string }
  | { kind: "member"; key: "ready" | "slot"; value: string }
  | { kind: "lock"; ids: string[] }
  | { kind: "send"; to: string; payload: WireMessage }
  | { kind: "checkpoint"; world: World };
export type NativeEvent =
  | { kind: "invite"; lobbyId: string }
  | { kind: "state"; state: LobbyState }
  | { kind: "message"; sender: string; payload: WireMessage }
  | { kind: "disconnected"; sender: string };
