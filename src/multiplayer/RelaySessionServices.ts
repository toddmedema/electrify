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
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
const CONNECTION_ERROR = "Could not reach the multiplayer service. Try again.";
const IDENTITY_KEY = "electrify-coop-player";
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

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
    if (saved && UUID.test(saved)) return saved;
    localStorage.setItem(IDENTITY_KEY, fresh);
  } catch {
    // Players can still join this session when storage is denied.
  }
  return fresh;
}

function openRelay(
  url: string,
  identity: () => { token: string; name?: string },
  onEvent: (event: SessionEvent) => void,
  onClose: () => void,
) {
  const socket = new WebSocket(url);
  let sequence = 0;
  let closed = false;
  const requests = new Map<number, (reply?: Reply) => void>();

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(startup);
    rejectReady(new Error(CONNECTION_ERROR));
    for (const finish of requests.values()) finish();
    onClose();
    socket.close();
  }

  function ask(input: object): Promise<unknown> {
    if (closed || socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error(CONNECTION_ERROR));
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      close();
      return Promise.reject(new Error(CONNECTION_ERROR));
    }
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const finish = (reply?: Reply) => {
        clearTimeout(timer);
        requests.delete(id);
        if (!reply) reject(new Error(CONNECTION_ERROR));
        else if (reply.code === "peer-disconnected")
          reject(new PeerDisconnectedError(reply.error));
        else if (reply.error) reject(new Error(reply.error));
        else resolve(reply.result);
      };
      const timer = setTimeout(close, REQUEST_TIMEOUT);
      requests.set(id, finish);
      try {
        socket.send(encodeWire({ id, input }));
      } catch {
        close();
      }
    });
  }

  let rejectReady: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    rejectReady = reject;
    socket.onopen = () => {
      void ask({ kind: "hello", ...identity() }).then(() => {
        clearTimeout(startup);
        resolve();
      }, close);
    };
  });
  const startup = setTimeout(close, REQUEST_TIMEOUT);
  socket.onmessage = (message) => {
    if (closed || typeof message.data !== "string") return;
    try {
      const packet = decodeWire(message.data) as Reply & {
        event?: SessionEvent;
      };
      if (packet.event) onEvent(packet.event);
      else requests.get(packet.reply)?.(packet);
    } catch {
      close();
    }
  };
  socket.onclose = close;
  return { ask, close, ready };
}

export function relaySessionServices(
  url: string,
  displayName: () => string | undefined,
): SessionServices {
  let token: string | undefined;
  let connection: ReturnType<typeof openRelay> | undefined;
  let lobby: LobbyState = { available: true, members: [], connected: [] };
  const events = new Set<(event: SessionEvent) => void>();

  function publish(event: SessionEvent) {
    if (event.kind === "state") lobby = event.state;
    for (const listener of events) listener(event);
  }

  async function connect() {
    if (!connection) {
      const opened = openRelay(
        url,
        () => ({ token: (token ??= localIdentity()), name: displayName() }),
        publish,
        () => {
          if (connection !== opened) return;
          connection = undefined;
          if (lobby.lobbyId && events.size)
            publish({
              kind: "state",
              state: {
                ...lobby,
                connected: [],
                error: "Connection lost. Reconnect to continue.",
              },
            });
        },
      );
      connection = opened;
    }
    const current = connection;
    await current.ready;
    return current;
  }

  return {
    transport: {
      async request<Request extends SessionRequest>(
        input: Request,
      ): Promise<SessionReply<Request>> {
        if (input.kind === "state") return lobby as SessionReply<Request>;
        if (input.kind === "leave" && !connection) {
          lobby = { available: true, members: [], connected: [] };
          return lobby as SessionReply<Request>;
        }
        const current =
          input.kind === "create" ||
          input.kind === "join" ||
          input.kind === "reconnect"
            ? await connect()
            : connection;
        if (!current) {
          if (input.kind === "send") throw new PeerDisconnectedError();
          throw new Error(CONNECTION_ERROR);
        }
        await current.ready;
        try {
          const result = await current.ask(
            input.kind === "reconnect"
              ? { ...input, roomId: lobby.lobbyId }
              : input,
          );
          if (result) lobby = result as LobbyState;
          return result as SessionReply<Request>;
        } catch (error) {
          if (input.kind === "send" && current !== connection)
            throw new PeerDisconnectedError();
          throw error;
        }
      },
      subscribe(listener) {
        events.add(listener);
        return () => {
          events.delete(listener);
          if (!events.size) connection?.close();
        };
      },
    },
    checkpoints: browserCheckpoints(),
  };
}
