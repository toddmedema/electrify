import type { SessionEvent, SessionRequest } from "./SessionTransport";
import type { World } from "./Types";

export type {
  LobbyMember,
  LobbyState,
  PendingCampaign,
  SharedSaveLibrary,
  WireMessage,
} from "./SessionTransport";

export type NativeRequest =
  | SessionRequest
  | { kind: "read-checkpoint"; id?: string }
  | { kind: "list-saves"; sync?: boolean }
  | { kind: "delete-save"; id: string }
  | { kind: "checkpoint"; world: World };

export type NativeEvent = SessionEvent;
