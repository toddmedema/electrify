import { browserCheckpoints } from "./BrowserCheckpoints";
import { PeerDisconnectedError } from "./SessionTransport";
import type {
  LobbyState,
  SessionEvent,
  SessionReply,
  SessionRequest,
  SessionServices,
} from "./SessionTransport";
import { decodeWire, encodeWire } from "./WireJson";

const REQUEST_TIMEOUT = 10_000;
const CONNECTION_ERROR = "Could not reach the multiplayer service. Try again.";
const IDENTITY_KEY = "electrify-coop-player";

type Reply = {
  reply: number;
  result?: unknown;
  error?: string;
  code?: string;
};

function localIdentity() {
  const fresh = crypto.randomUUID();
  try {
    const saved = localStorage.getItem(IDENTITY_KEY);
    if (saved && /^[a-f0-9-]{36}$/.test(saved)) return saved;
    localStorage.setItem(IDENTITY_KEY, fresh);
  } catch {
    // Players can still join this session when storage is denied.
  }
  return fresh;
}

export function relaySessionServices(
  url: string,
  displayName: () => string | undefined,
): SessionServices {
  let token: string | undefined;
  let socket: WebSocket | undefined;
  let opening: Promise<WebSocket> | undefined;
  let sequence = 0;
  let lobby: LobbyState = { available: true, members: [], connected: [] };
  const events = new Set<(event: SessionEvent) => void>();
  const requests = new Map<
    number,
    { finish: (value?: Reply, error?: Error) => void }
  >();

  function publish(event: SessionEvent) {
    if (event.kind === "state") lobby = event.state;
    for (const listener of events) listener(event);
  }

  function ask(connection: WebSocket, input: object) {
    if (connection.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error(CONNECTION_ERROR));
    return new Promise<unknown>((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        if (requests.has(id)) connection.close();
      }, REQUEST_TIMEOUT);
      const finish = (value?: Reply, error?: Error) => {
        clearTimeout(timer);
        requests.delete(id);
        if (error) reject(error);
        else if (value?.code === "peer-disconnected")
          reject(new PeerDisconnectedError(value.error));
        else if (value?.error) reject(new Error(value.error));
        else resolve(value?.result);
      };
      requests.set(id, { finish });
      try {
        connection.send(encodeWire({ id, input }));
      } catch {
        finish(undefined, new Error(CONNECTION_ERROR));
      }
    });
  }

  function connect() {
    if (opening) return opening;
    if (socket?.readyState === WebSocket.OPEN) return Promise.resolve(socket);
    const connection = new WebSocket(url);
    socket = connection;
    opening = new Promise<WebSocket>((resolve, reject) => {
      const startup = setTimeout(() => connection.close(), REQUEST_TIMEOUT);
      connection.onopen = () => {
        token ??= localIdentity();
        void ask(connection, {
          kind: "hello",
          token,
          name: displayName(),
        }).then(
          () => {
            clearTimeout(startup);
            resolve(connection);
          },
          (error) => {
            connection.close();
            reject(error);
          },
        );
      };
      connection.onmessage = (message) => {
        if (socket !== connection || typeof message.data !== "string") return;
        try {
          const packet = decodeWire(message.data) as Reply & {
            event?: SessionEvent;
          };
          if (packet.event) publish(packet.event);
          else requests.get(packet.reply)?.finish(packet);
        } catch {
          connection.close();
        }
      };
      connection.onclose = () => {
        clearTimeout(startup);
        reject(new Error(CONNECTION_ERROR));
        if (socket !== connection) return;
        socket = undefined;
        for (const operation of requests.values())
          operation.finish(undefined, new Error(CONNECTION_ERROR));
        if (lobby.lobbyId)
          publish({
            kind: "state",
            state: {
              ...lobby,
              connected: [],
              error: "Connection lost. Reconnect to continue.",
            },
          });
      };
    }).finally(() => {
      opening = undefined;
    });
    return opening;
  }

  return {
    transport: {
      async request<Request extends SessionRequest>(
        input: Request,
      ): Promise<SessionReply<Request>> {
        if (input.kind === "state") return lobby as SessionReply<Request>;
        if (input.kind === "leave" && socket?.readyState !== WebSocket.OPEN) {
          lobby = { available: true, members: [], connected: [] };
          return lobby as SessionReply<Request>;
        }
        const allowConnect =
          input.kind === "create" ||
          input.kind === "join" ||
          input.kind === "reconnect";
        const connection = allowConnect ? await connect() : socket;
        if (!connection || connection.readyState !== WebSocket.OPEN) {
          if (input.kind === "send") throw new PeerDisconnectedError();
          throw new Error(CONNECTION_ERROR);
        }
        const result = await ask(
          connection,
          input.kind === "reconnect"
            ? { ...input, roomId: lobby.lobbyId }
            : input,
        );
        if (result) lobby = result as LobbyState;
        return result as SessionReply<Request>;
      },
      subscribe(listener) {
        events.add(listener);
        return () => {
          events.delete(listener);
          if (!events.size) socket?.close();
        };
      },
    },
    checkpoints: browserCheckpoints(),
  };
}
