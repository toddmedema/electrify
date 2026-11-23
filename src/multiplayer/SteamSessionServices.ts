import type { DesktopBridge } from "../Desktop";
import type { NativeRequest } from "./Native";
import { PeerDisconnectedError } from "./SessionTransport";
import type {
  SessionReply,
  SessionRequest,
  SessionServices,
  SharedSaveLibrary,
} from "./SessionTransport";
import type { World } from "./Types";

// The native bridge predates typed replies. Keep its IPC casts and player-facing errors here.
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']*': (?:Error: )?/;

export function steamSessionServices(bridge?: DesktopBridge): SessionServices {
  const request = async (input: NativeRequest) => {
    if (!bridge?.multiplayerRequest)
      throw new Error("Update the desktop game to play online");
    try {
      return await bridge.multiplayerRequest(input);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const message = error.message.replace(IPC_ERROR_PREFIX, "");
      if (input.kind === "send" && /\bPlayer is disconnected\b/.test(message))
        throw new PeerDisconnectedError(message);
      throw message === error.message ? error : new Error(message);
    }
  };

  return {
    transport: {
      request: <Request extends SessionRequest>(input: Request) =>
        request(input) as Promise<SessionReply<Request>>,
      subscribe: (listener) =>
        bridge?.onMultiplayerEvent?.(listener) ?? (() => {}),
    },
    checkpoints: {
      read: (id) =>
        request({
          kind: "read-checkpoint",
          ...(id && { id }),
        }) as Promise<World | null>,
      list: (sync) =>
        request({ kind: "list-saves", sync }) as Promise<SharedSaveLibrary>,
      remove: (id) =>
        request({ kind: "delete-save", id }) as Promise<SharedSaveLibrary>,
      write: async (world) => {
        await request({ kind: "checkpoint", world });
      },
    },
  };
}
