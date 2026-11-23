import manifest from "../data/RunCompatibility.json";
import { CrossplayApiError, type CrossplayApi } from "./CrossplayApi";
import { PeerDisconnectedError } from "./SessionTransport";
import type {
  AuthorityWindow,
  LobbyState,
  SessionEvent,
  SessionReply,
  SessionRequest,
  SessionServices,
} from "./SessionTransport";
import { TurnPeers } from "./TurnPeers";
import {
  onlineCheckpoints,
  readTransfer,
  storeTransfer,
} from "./OnlineCheckpoints";

interface RoomAuthority {
  epoch: string;
  binding: string;
  presence?: string;
  hostBinding: string;
  leaseRemainingMs: number;
  requiredIds: string[];
  locked: boolean;
  head: { savedAt: number; epoch: string } | null;
}

interface RoomReply {
  lobby: LobbyState;
  authority?: RoomAuthority | null;
}

const POLL_MS = 1_500;
const MAX_AUTHORITY_MS = 4_000;
const INITIAL_LOBBY: LobbyState = {
  available: true,
  members: [],
  connected: [],
};

export function onlineSessionServices(
  platformApi: CrossplayApi,
  displayName: () => string | undefined,
): SessionServices {
  let lobby: LobbyState = INITIAL_LOBBY;
  let roomId: string | undefined;
  let authority: AuthorityWindow | undefined;
  let presence: string | undefined;
  let connected: string[] = [];
  let refreshedInvite:
    | {
        code: string;
        token: string;
        expiresAt: number;
        version: string;
      }
    | undefined;
  let version = 0;
  let applied = 0;
  let lastRequest = 0;
  let actions = 0;
  let latestAction = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let hidden = document.visibilityState === "hidden";
  let active = false;
  const listeners = new Set<(event: SessionEvent) => void>();
  const liveAuthority = () =>
    authority &&
    !hidden &&
    performance.timeOrigin + performance.now() < authority.monotonicDeadline &&
    Date.now() < authority.wallDeadline
      ? authority
      : undefined;

  function publish(state: LobbyState) {
    lobby = state;
    for (const listener of listeners) listener({ kind: "state", state });
  }

  let bulkQueue: Promise<unknown> = Promise.resolve();
  let bulkPending = 0;
  const api: CrossplayApi = {
    async request<T>(
      operation: string,
      body: unknown,
      options?: Parameters<CrossplayApi["request"]>[2],
    ) {
      if (!operation.startsWith("transfer/") && !operation.startsWith("save/"))
        return platformApi.request<T>(operation, body, options);
      if (bulkPending >= 8) throw new CrossplayApiError("transfer-limit");
      bulkPending++;
      const transfer = bulkQueue
        .then(() => {
          options?.signal?.throwIfAborted();
          return platformApi.request<T>(operation, body, options);
        })
        .finally(() => bulkPending--);
      bulkQueue = transfer.catch(() => undefined);
      return transfer;
    },
  };

  const peers = new TurnPeers(api, {
    message: (sender, payload) => {
      if (!liveAuthority() || !connected.includes(sender)) return;
      for (const listener of listeners)
        listener({ kind: "message", sender, payload });
    },
    status: (ids) => {
      connected = liveAuthority() ? ids : [];
      publish({ ...lobby, connected });
    },
    storeTransfer: (peer, payload, signal) =>
      storeTransfer(api, peer, payload, signal),
    readTransfer: (peer, reference, signal) =>
      readTransfer(api, peer, reference, signal),
  });

  function expire(error?: string) {
    clearTimeout(expiry);
    authority = undefined;
    connected = [];
    peers.close();
    if (lobby.lobbyId) publish({ ...lobby, connected: [], error });
  }

  function schedule(delay = POLL_MS) {
    clearTimeout(timer);
    if (!active || hidden || !roomId) return;
    timer = setTimeout(() => {
      if (actions) return schedule();
      const before = version;
      void roomRequest("state", { roomId })
        .catch((error: unknown) => {
          if (before !== version || !(error instanceof CrossplayApiError))
            return;
          if (
            error.code === "invalid_invite" ||
            error.code === "room_unavailable"
          ) {
            version++;
            roomId = undefined;
            expire();
            publish({
              ...INITIAL_LOBBY,
              error: lobby.joinPending
                ? "This invitation is no longer available."
                : "This multiplayer room is no longer available.",
            });
          } else if (
            error.code === "unauthenticated" ||
            error.code === "seat_reclaim_required"
          ) {
            expire(
              "Your multiplayer seat needs to be reconnected on this device.",
            );
          }
        })
        .finally(() => schedule());
    }, delay);
  }

  async function roomRequest(
    operation: string,
    body: object,
    userAction = false,
  ) {
    const current = version;
    const sequence = ++lastRequest;
    const monotonic = performance.now();
    const wall = Date.now();
    const action = operation !== "state";
    if (action) {
      latestAction = sequence;
      actions++;
    }
    let result: RoomReply;
    try {
      result = await api.request<RoomReply>(`room/${operation}`, body, {
        userAction,
      });
    } finally {
      if (action) actions--;
    }
    if (
      !active ||
      current !== version ||
      sequence < applied ||
      (!action && sequence < latestAction)
    )
      return lobby;
    applied = sequence;
    roomId = result.lobby.lobbyId;
    const grant = result.authority;
    presence = grant?.presence;
    if (
      result.lobby.inviteCode &&
      result.lobby.inviteToken &&
      result.lobby.inviteExpiresAt &&
      result.lobby.inviteVersion
    ) {
      refreshedInvite = {
        code: result.lobby.inviteCode,
        token: result.lobby.inviteToken,
        expiresAt: result.lobby.inviteExpiresAt,
        version: result.lobby.inviteVersion,
      };
    } else if (
      refreshedInvite?.version !== result.lobby.inviteVersion ||
      (refreshedInvite && refreshedInvite.expiresAt <= Date.now())
    ) {
      refreshedInvite = undefined;
    }
    if (
      !hidden &&
      grant &&
      roomId &&
      result.lobby.selfId &&
      result.lobby.hostId &&
      grant.leaseRemainingMs > 0
    ) {
      if (authority && authority.epoch !== grant.epoch) expire();
      const remaining = Math.min(MAX_AUTHORITY_MS, grant.leaseRemainingMs);
      authority = {
        epoch: grant.epoch,
        monotonicDeadline: performance.timeOrigin + monotonic + remaining,
        wallDeadline: wall + remaining,
      };
      clearTimeout(expiry);
      expiry = setTimeout(
        () => {
          expire("Connection to the multiplayer service was interrupted.");
        },
        Math.max(0, remaining - (performance.now() - monotonic)),
      );
      publish({
        ...result.lobby,
        savedAt: lobby.savedAt,
        sharedAt: grant.head?.savedAt,
        inviteCode: refreshedInvite?.code,
        inviteToken: refreshedInvite?.token,
        authorityEpoch: grant.epoch,
        campaignLocked: grant.locked,
        requiredPlayers: grant.requiredIds,
        recoveryAvailable: !!grant.head && grant.head.epoch !== grant.epoch,
        connected,
      });
      if (liveAuthority()) {
        peers.update(
          {
            roomId,
            selfId: result.lobby.selfId,
            hostId: result.lobby.hostId,
            epoch: grant.epoch,
            binding: grant.binding,
            leaseRemainingMs: remaining,
          },
          monotonic,
        );
      }
    } else {
      expire();
      publish({
        ...result.lobby,
        authorityEpoch: grant?.epoch,
        campaignLocked: grant?.locked,
        requiredPlayers: grant?.requiredIds,
        recoveryAvailable: grant?.locked && !!grant.head,
        connected: [],
      });
    }
    return lobby;
  }

  function suspend() {
    if (hidden) return;
    hidden = true;
    version++;
    clearTimeout(timer);
    expire();
    if (roomId && presence)
      void api
        .request("room/suspend", { roomId, presence })
        .catch(() => undefined);
  }

  function resume() {
    const wasHidden = hidden;
    hidden = document.visibilityState === "hidden";
    if (wasHidden && !hidden && roomId) {
      void roomRequest("reconnect", {
        roomId,
        rules: manifest.multiplayerCompatibilityId,
      })
        .catch(() => undefined)
        .finally(() => schedule());
    }
  }

  function onVisibility() {
    if (document.visibilityState === "hidden") suspend();
    else resume();
  }

  return {
    authority: liveAuthority,
    onlineCampaigns: true,
    checkpoints: onlineCheckpoints(
      api,
      () => ({ roomId, seatId: lobby.selfId }),
      (savedAt) => publish({ ...lobby, savedAt }),
    ),
    transport: {
      subscribe(listener) {
        listeners.add(listener);
        active = true;
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("pagehide", suspend);
        window.addEventListener("pageshow", resume);
        return () => {
          listeners.delete(listener);
          if (listeners.size) return;
          active = false;
          version++;
          clearTimeout(timer);
          expire();
          document.removeEventListener("visibilitychange", onVisibility);
          window.removeEventListener("pagehide", suspend);
          window.removeEventListener("pageshow", resume);
        };
      },
      async request<Request extends SessionRequest>(
        input: Request,
      ): Promise<SessionReply<Request>> {
        type Reply = SessionReply<Request>;
        if (input.kind === "state") return lobby as Reply;
        if (input.kind === "send") {
          if (!liveAuthority()) throw new PeerDisconnectedError();
          await peers.send(input.to, input.payload);
          return undefined as Reply;
        }
        if (input.kind === "leave") {
          const departed = roomId;
          version++;
          roomId = undefined;
          refreshedInvite = undefined;
          clearTimeout(timer);
          expire();
          publish(INITIAL_LOBBY);
          if (departed) await api.request("room/leave", { roomId: departed });
          return lobby as Reply;
        }
        if (input.kind === "create" || input.kind === "join") {
          version++;
          expire();
          roomId = undefined;
          refreshedInvite = undefined;
          const name =
            Array.from((displayName() ?? "").replace(/\p{Cc}/gu, "").trim())
              .slice(0, 20)
              .join("") || "Player";
          return (await roomRequest(
            input.kind,
            {
              rules: input.rules,
              name,
              ...(input.kind === "join" && { invite: input.lobbyId }),
            },
            true,
          ).finally(() => schedule())) as Reply;
        }
        const { kind, ...body } = input;
        return (await roomRequest(
          kind,
          {
            roomId,
            ...body,
            ...(kind === "reconnect" && {
              rules: manifest.multiplayerCompatibilityId,
            }),
          },
          kind === "reconnect",
        ).finally(() => {
          if (kind === "reconnect") schedule();
        })) as Reply;
      },
    },
  };
}
