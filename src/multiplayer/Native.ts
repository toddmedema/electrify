import type { BrowseState } from "./Browse";
import type { CommandEnvelope, RoomView, Seat, World } from "./Types";
/** A lobby member, with the selection they last marked Ready for (see selectionKey). */
export interface LobbyMember extends Seat {
  ready?: string;
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
export type WireMessage =
  | { kind: "heartbeat" }
  | { kind: "keepalive"; matchId: string; epoch: string; revision: number }
  | { kind: "view"; view: RoomView }
  | { kind: "save-request"; requestId: string }
  | { kind: "save-result"; requestId: string; error?: string }
  | { kind: "command"; envelope: CommandEnvelope }
  | { kind: "browse"; browse: BrowseState };
export type NativeRequest =
  | {
      kind:
        | "state"
        | "leave"
        | "reconnect"
        | "invite"
        | "read-checkpoint"
        | "unlock";
    }
  | { kind: "create"; rules: string }
  | { kind: "join"; rules: string; lobbyId: string }
  | { kind: "member"; key: "ready"; value: string }
  | { kind: "lock"; ids: string[] }
  | { kind: "send"; to: string; payload: WireMessage }
  | { kind: "checkpoint"; world: World };
export type NativeEvent =
  | { kind: "invite"; lobbyId: string }
  | { kind: "state"; state: LobbyState }
  | { kind: "message"; sender: string; payload: WireMessage }
  | { kind: "disconnected"; sender: string };
