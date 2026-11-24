import manifest from "../data/RunCompatibility.json";
import type {
  Command,
  CommandEnvelope,
  MatchSpec,
  RoomView,
  Seat,
} from "./Types";
import { PeerDisconnectedError } from "./SessionTransport";
import type {
  LobbyState,
  SessionEvent,
  SessionRequest,
  SessionServices,
  PendingCampaign,
  SharedSaveLibrary,
  WireMessage,
} from "./SessionTransport";
import type { ReplicaBaseline } from "./Replication";
import type {
  ReplicaProgress,
  ReplicaRequest,
  ReplicaResponse,
} from "./ReplicaProtocol";
import type { WorkerRequest, WorkerResponse } from "./WorkerProtocol";
import {
  selectionKey,
  validBrowseState,
  type BrowseState,
  type HostBrowseSelection,
} from "./Browse";
import { modBrowseSummary, validSelectedMod } from "./ModBrowse";
import type {
  FacilityShoppingType,
  ScenarioType,
  TerritoryId,
  TerritoryTileId,
} from "../Types";
import { validScenarioMod } from "../helpers/ScenarioMod";
import { resumeBlocker, resumeSeats, slotClaim } from "./Slots";
import {
  BROWSE_RESEND_MS,
  COMMAND_RESEND_MS,
  HOST_SILENCE_MS,
  MAX_QUEUED_COMMANDS,
  ONLINE_SAVE_TIMEOUT_MS,
  SAVE_TIMEOUT_MS,
  SESSION_PUMP_MS,
  VIEW_INTERVAL_MS,
} from "./Timing";

function validPendingCampaign(value: unknown): value is PendingCampaign {
  if (!value || typeof value !== "object") return false;
  const campaign = value as PendingCampaign;
  if (
    typeof campaign.id !== "string" ||
    !campaign.id ||
    campaign.id.length > 64 ||
    typeof campaign.name !== "string" ||
    !campaign.name.trim() ||
    campaign.name.length > 80 ||
    !Array.isArray(campaign.players) ||
    campaign.players.length < 2 ||
    campaign.players.length > 4 ||
    !campaign.players.every(
      (player) =>
        player &&
        typeof player.id === "string" &&
        /^[a-zA-Z0-9-]{1,64}$/.test(player.id) &&
        typeof player.name === "string" &&
        !!player.name.trim() &&
        player.name.length <= 200,
    ) ||
    !Array.isArray(campaign.requiredPlayerIds)
  )
    return false;
  const ids = new Set(campaign.players.map((player) => player.id));
  return (
    ids.size === campaign.players.length &&
    new Set(campaign.requiredPlayerIds).size ===
      campaign.requiredPlayerIds.length &&
    campaign.requiredPlayerIds.every((id) => ids.has(id))
  );
}

/** A guest's lobby closed before the match began, because its host left. */
export const HOST_LEFT = "The host closed the lobby.";

/** A guest's match lost its host mid-game; the connection notice shows this message. */
export const CONNECTION_LOST = "Connection to the host was interrupted.";
/** Whether a shown error means the link to the host is gone, as opposed to a failed save or a
 * refused command. Native lobby errors come only from its connection failures. */
export const isConnectionLoss = (error?: string, lobbyError?: string) =>
  error === CONNECTION_LOST || (!error && !!lobbyError);
export interface SessionState {
  lobby: LobbyState;
  view?: RoomView;
  pending: boolean;
  busy: boolean;
  entryOperation?: "create" | "join";
  waitingForHost: boolean;
  /** A confirmed new epoch replaced the retained view and its worker. */
  checkpointRecovery?: { confirmedRevision: number };
  /** A replica is receiving data or recovering; commands wait for a live local world. */
  synchronizing?: boolean;
  error?: string;
  /** The scenario selection the lobby is browsing; the host authors it, guests follow it. */
  browse?: BrowseState;
  /** Validated, detached scenario; never written into the installed library. */
  scenarioSnapshot?: ScenarioType;
  pendingCampaign?: PendingCampaign;
  /** The host's multiplayer saves, loaded when it opens a lobby. */
  library?: SharedSaveLibrary;
  loadingSaves: boolean;
}
export class MultiplayerSession {
  private state: SessionState = {
    lobby: { available: false, members: [], connected: [] },
    pending: false,
    busy: false,
    waitingForHost: false,
    loadingSaves: false,
  };
  private libraryRequest = 0;
  private listeners = new Set<() => void>();
  private worker?: Worker;
  private hostedView = false;
  private replica?: Worker;
  private replicaOpening?: Promise<Worker | undefined>;
  private replicaGeneration = 0;
  private replicaQueue = Promise.resolve();
  private replicaQueuedRecords = 0;
  private replicaQueuedBytes = 0;
  private replicaProgress?: ReplicaProgress;
  private replicaStream?: {
    matchId: string;
    epoch: string;
  };
  private replicaDisconnected: string[] = [];
  private replicationSends = new Map<string, Promise<unknown>>();
  private replicationConnections = new Map<string, object>();
  private pendingScenarioBaseline?: ReplicaBaseline;
  private pendingScenarioRecords: Extract<
    ReplicaRequest,
    { kind: "records" }
  >[] = [];
  private replicaLive = false;
  private replicaStopped?: string;
  private lastReplicaResync = -Infinity;
  private stopEvents?: () => void;
  private pending?: CommandEnvelope;
  private completion?: { resolve: () => void; reject: (error: Error) => void };
  private queued: {
    command: Command;
    resolve: () => void;
    reject: (error: Error) => void;
  }[] = [];
  private activity: string | null = null;
  private sequence = 0;
  private closing = false;
  private departingLobbyId?: string;
  private interruptedJoinLobbyId?: string;
  private receiptSequence = 0;
  private lastHostMessage = Date.now();
  private lastSend = 0;
  private connected = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private lifecycle = 0;
  private lastHost?: { room: string; epoch: string };
  private startGeneration = 0;
  private campaignGeneration = 0;
  private startupCleanup: Promise<unknown> = Promise.resolve();
  private saveRequests = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >();
  private saving: Promise<unknown> = Promise.resolve();
  private browseSession?: string;
  private browseRevision = 0;
  private publishedSelection?: string;
  private browseTimer?: ReturnType<typeof setTimeout>;
  private lastBrowseSend = 0;
  private browsePeers = new Set<string>();
  private outboundScenario = new Map<string, string>();
  private receivedScenario?: { key: string; scenario: ScenarioType };
  constructor(
    private services: SessionServices,
    private workerFactory: () => Promise<Worker>,
    private replicaFactory: () => Promise<Worker>,
  ) {}
  getSnapshot = () => this.state;
  get onlineCampaigns() {
    return this.services.onlineCampaigns === true;
  }
  private authorityIsCurrent(epoch?: string) {
    if (!this.services.authority) return true;
    const authority = this.services.authority();
    return !!authority && (!epoch || epoch === authority.epoch);
  }
  private relayAuthority() {
    this.post({ kind: "heartbeat", authority: this.services.authority?.() });
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(update: Partial<SessionState>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach((l) => l());
  }
  private request<Request extends SessionRequest>(input: Request) {
    return this.services.transport.request(input);
  }
  private post(input: WorkerRequest) {
    this.worker?.postMessage(input);
  }
  async initialize(onInvite?: (lobbyId: string) => void) {
    const lifecycle = ++this.lifecycle;
    let ready = false;
    let pendingInvite: string | undefined;
    const deliverInvite = () => {
      if (!ready || !pendingInvite || lifecycle !== this.lifecycle) return;
      const { busy, lobby, view, synchronizing } = this.state;
      if (this.closing || busy) return;
      const lobbyId = pendingInvite;
      pendingInvite = undefined;
      if (!view && !synchronizing && lobby.lobbyId !== lobbyId)
        onInvite?.(lobbyId);
    };
    this.stopEvents = this.services.transport.subscribe((event) => {
      if (lifecycle !== this.lifecycle) return;
      if (event.kind === "invite") {
        pendingInvite = event.lobbyId;
        deliverInvite();
      } else this.event(event);
    });
    const lobby = await this.request({ kind: "state" });
    if (lifecycle !== this.lifecycle) return;
    this.update({ lobby });
    pendingInvite ??= lobby.inviteLobbyId;
    ready = true;
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      // A Steam invitation can arrive while another lobby operation is awaiting IPC.
      deliverInvite();
      if (this.worker) this.relayAuthority();
      else if (
        this.state.lobby.hostId &&
        this.state.lobby.hostId !== this.state.lobby.selfId &&
        this.state.lobby.connected.includes(this.state.lobby.hostId)
      ) {
        void this.request({
          kind: "send",
          to: this.state.lobby.hostId,
          payload: this.replicaProgress
            ? { kind: "progress", ...this.replicaProgress }
            : { kind: "heartbeat" },
        }).catch(() => {});
      }
      if (this.pending && Date.now() - this.lastSend > COMMAND_RESEND_MS)
        this.transmit();
      // The unchanged selection is resent now and then, so a guest that missed one catches up.
      if (
        this.isHost() &&
        this.state.browse &&
        Date.now() - this.lastBrowseSend > BROWSE_RESEND_MS
      )
        this.sendBrowse();
      if (
        this.isHost() &&
        this.state.pendingCampaign &&
        Date.now() - this.lastBrowseSend > BROWSE_RESEND_MS
      )
        this.sendCampaign();
      const waitingForHost =
        (!!this.state.view || !!this.state.synchronizing) &&
        !this.worker &&
        !this.closing &&
        !this.replicaStopped &&
        Date.now() - this.lastHostMessage > HOST_SILENCE_MS;
      if (waitingForHost !== this.state.waitingForHost)
        this.update({ waitingForHost });
    }, SESSION_PUMP_MS);
    deliverInvite();
  }
  private event(event: Exclude<SessionEvent, { kind: "invite" }>) {
    if (event.kind === "state") {
      const { hostId, lobbyId, members } = event.state;
      // Steam can publish the old roster as it closes each peer connection.
      if (lobbyId && lobbyId === this.departingLobbyId) return;
      // Before a match, a lobby without its host has nobody left to choose or start a game.
      if (
        lobbyId &&
        hostId &&
        hostId !== event.state.selfId &&
        !this.state.view &&
        !this.closing &&
        members.length > 0 &&
        !members.some((member) => member.id === hostId)
      ) {
        this.update({ lobby: event.state });
        this.handleHostLeft();
        return;
      }
      if (
        this.services.authority &&
        this.lastHost &&
        event.state.authorityEpoch &&
        (this.lastHost.room !== event.state.lobbyId ||
          this.lastHost.epoch !== event.state.authorityEpoch)
      ) {
        const error = new Error(
          "Host changed. Actions from the previous session were discarded.",
        );
        this.startGeneration++;
        this.worker?.terminate();
        this.worker = undefined;
        this.stopReplica();
        this.replicaStream = undefined;
        this.replicationSends.clear();
        this.replicationConnections.clear();
        this.completion?.reject(error);
        this.queued.forEach((queued) => queued.reject(error));
        this.completion = undefined;
        this.queued = [];
        this.pending = undefined;
        for (const request of this.saveRequests.values()) request.reject(error);
        this.saveRequests.clear();
        this.sequence = 0;
        this.receiptSequence = 0;
        this.state = {
          ...this.state,
          pending: false,
          busy: false,
          waitingForHost: true,
        };
      }
      if (!event.state.lobbyId) this.lastHost = undefined;
      else if (event.state.authorityEpoch)
        this.lastHost = {
          room: event.state.lobbyId,
          epoch: event.state.authorityEpoch,
        };
      const { authorityEpoch, confirmedRevision, recoveryAvailable } =
        event.state;
      const view = this.state.view;
      // A missing grant can be transient. Remember a confirmed replacement of
      // the displayed epoch so a subsequent outage cannot strand the player.
      const checkpointRecovery =
        view &&
        !this.worker &&
        !!authorityEpoch &&
        authorityEpoch !== view.epoch &&
        recoveryAvailable &&
        confirmedRevision !== undefined &&
        this.services.authority?.()?.epoch === authorityEpoch
          ? { confirmedRevision }
          : this.state.checkpointRecovery;
      this.update({ lobby: event.state, checkpointRecovery });
      if (this.worker) this.relayAuthority();
      if (this.isHost()) {
        // A friend who just joined lands on the page the host is showing, straight away.
        const joined = event.state.connected.filter(
          (id) => !this.browsePeers.has(id),
        );
        this.browsePeers = new Set(event.state.connected);
        for (const id of this.outboundScenario.keys())
          if (!event.state.connected.includes(id))
            this.outboundScenario.delete(id);
        if (joined.length) {
          this.sendBrowse(joined);
          this.sendCampaign(joined);
        }
      }
      if (this.worker) {
        const now = new Set(event.state.connected);
        for (const id of this.connected)
          if (!now.has(id)) {
            this.forgetReplicationConnection(id);
            this.post({ kind: "disconnect", sender: id });
          }
        const joined = [...now].filter((id) => !this.connected.has(id));
        this.connected = now;
        // Recovery refuses baselines for disconnected peers, so membership must arrive first.
        this.sendMembership();
        // A reconnected client needs a fresh complete view, including paused command receipts.
        for (const id of joined)
          if (id !== this.state.lobby.selfId)
            this.post({ kind: "baseline", to: id });
      }
    } else if (event.kind === "disconnected") {
      if (this.worker) {
        this.forgetReplicationConnection(event.sender);
        this.connected.delete(event.sender);
        this.update({
          lobby: {
            ...this.state.lobby,
            connected: this.state.lobby.connected.filter(
              (id) => id !== event.sender,
            ),
          },
        });
        // Native disconnect arrives before the next lobby state. Retire the old channel
        // before the worker's pause records can trigger recovery on that dead connection.
        this.sendMembership();
        this.post({ kind: "disconnect", sender: event.sender });
      }
      // A friend leaving before the match begins is routine; only a guest loses its game.
      else if (
        this.isHost() ||
        this.closing ||
        event.sender !== this.state.lobby.hostId
      )
        return;
      else if (!this.state.view) this.handleHostLeft();
      else
        this.update({
          error: CONNECTION_LOST,
        });
    } else if (event.kind === "message") {
      if (
        !this.authorityIsCurrent(
          "epoch" in event.payload ? event.payload.epoch : undefined,
        )
      )
        return;
      if (
        this.worker &&
        this.state.lobby.connected.includes(event.sender) &&
        (event.payload.kind === "progress" || event.payload.kind === "resync")
      ) {
        this.post({ ...event.payload, sender: event.sender });
        return;
      }
      if (
        !this.worker &&
        !this.closing &&
        !!this.state.lobby.lobbyId &&
        event.sender === this.state.lobby.hostId
      ) {
        const payload = event.payload;
        if (payload.kind === "baseline") {
          this.acceptBaseline(payload);
          return;
        }
        if (payload.kind === "records") {
          if (this.replicationStream(payload)) {
            this.hostActivity();
            if (this.pendingScenarioBaseline) {
              this.pendingScenarioRecords.push(payload);
              if (
                this.pendingScenarioRecords.reduce(
                  (sum, batch) => sum + batch.records.length,
                  0,
                ) > 1024 ||
                new TextEncoder().encode(
                  JSON.stringify(this.pendingScenarioRecords),
                ).length >
                  4 * 1024 * 1024
              ) {
                this.pendingScenarioRecords = [];
                this.requestReplicaResync("Scenario loading buffer overflow");
              }
            } else this.toReplica(payload);
          }
          return;
        }
        if (payload.kind === "rejected") {
          if (
            this.replicationStream(payload) &&
            this.pending?.sequence === payload.sequence
          ) {
            this.completion?.reject(new Error(payload.error));
            this.completion = undefined;
            this.pending = undefined;
            this.sequence = this.state.view?.lastSequence ?? 0;
            this.update({ pending: false, error: payload.error });
            this.flushQueued();
          }
          return;
        }
      }
      if (this.worker && event.payload.kind === "save-request") {
        const requestId = event.payload.requestId;
        const respond = (error?: string) =>
          this.request({
            kind: "send",
            to: event.sender,
            payload: { kind: "save-result", requestId, error },
          });
        const suspended = event.payload.suspended === true;
        void this.save(
          suspended || event.payload.pause === true,
          true,
          suspended,
        )
          .then(
            () => respond(),
            (error) => respond(error.message),
          )
          .catch(() => undefined);
        return;
      }
      if (
        !this.worker &&
        event.sender === this.state.lobby.hostId &&
        event.payload.kind === "campaign"
      ) {
        if (
          event.payload.campaign === undefined ||
          validPendingCampaign(event.payload.campaign)
        ) {
          this.receivedScenario = undefined;
          this.update({
            pendingCampaign: event.payload.campaign,
            browse: undefined,
            scenarioSnapshot: undefined,
          });
        }
        return;
      }
      if (
        !this.worker &&
        event.sender === this.state.lobby.hostId &&
        event.payload.kind === "scenario"
      ) {
        this.acceptScenario(event.payload.selectionKey, event.payload.scenario);
        return;
      }
      if (
        !this.worker &&
        event.sender === this.state.lobby.hostId &&
        event.payload.kind === "browse"
      ) {
        this.acceptBrowse(event.payload.browse);
        return;
      }
      if (
        !this.worker &&
        event.sender === this.state.lobby.hostId &&
        event.payload.kind === "save-result"
      ) {
        const request = this.saveRequests.get(event.payload.requestId);
        this.saveRequests.delete(event.payload.requestId);
        if (event.payload.error)
          request?.reject(new Error(event.payload.error));
        else request?.resolve();
        return;
      }
      if (this.worker && event.payload.kind === "command") {
        if (this.closing) return;
        // A ready sent while someone is away still gets a receipt, so the sender's pending
        // command settles with an explanation instead of retrying until everyone returns.
        this.post({
          kind: "command",
          sender: event.sender,
          envelope: event.payload.envelope,
          allowReady: this.everyoneConnected(),
        });
      } else if (
        !this.worker &&
        !this.closing &&
        !!this.state.lobby.lobbyId &&
        event.sender === this.state.lobby.hostId &&
        event.payload.kind === "keepalive"
      ) {
        const { view } = this.state;
        const pulse = event.payload;
        if (
          this.replicationStream(pulse) &&
          pulse.matchId === (view?.matchId ?? this.replicaStream?.matchId) &&
          pulse.epoch === (view?.epoch ?? this.replicaStream?.epoch) &&
          Number.isSafeInteger(pulse.revision) &&
          pulse.revision >= (view?.revision ?? 0)
        ) {
          this.hostActivity();
          if (pulse.disconnected) {
            this.replicaDisconnected = [...pulse.disconnected];
            if (view)
              this.update({
                view: { ...view, disconnected: this.replicaDisconnected },
              });
          }
        }
      }
    }
  }
  /** Apply a projection from the authoritative host worker or the guest's local replica. */
  private acceptView(view: RoomView) {
    if (!this.authorityIsCurrent(view.epoch)) return;
    const terminalError = this.replicaStopped;
    const previous = this.state.view;
    if (
      previous &&
      previous.epoch === view.epoch &&
      view.revision < previous.revision
    )
      return;
    if (previous?.epoch !== view.epoch) {
      this.completion?.reject(new Error("The shared session changed"));
      this.queued.forEach((q) =>
        q.reject(new Error("The shared session changed")),
      );
      this.completion = undefined;
      this.queued = [];
      this.pending = undefined;
      this.sequence = 0;
      this.receiptSequence = 0;
    }
    this.lastHostMessage = Date.now();
    const acknowledged = this.pending?.command;
    let completed:
      { resolve: () => void; reject: (error: Error) => void } | undefined;
    if (
      this.pending &&
      (view.lastSequence >= this.pending.sequence ||
        view.receipt?.sequence === this.pending.sequence)
    ) {
      completed = this.completion;
      this.completion = undefined;
      this.pending = undefined;
    }
    if (terminalError) {
      // The final projection can acknowledge work recorded before the fault. Everything else
      // must settle without resending into a terminal stream.
      this.completion?.reject(new Error(terminalError));
      this.queued.forEach((queued) => queued.reject(new Error(terminalError)));
      this.completion = undefined;
      this.pending = undefined;
      this.queued = [];
    }
    const newReceipt =
      view.receipt && view.receipt.sequence > this.receiptSequence;
    if (newReceipt) this.receiptSequence = view.receipt!.sequence;
    if (newReceipt && view.receipt?.error && !this.pending)
      this.sequence = view.lastSequence;
    else this.sequence = Math.max(this.sequence, view.lastSequence);
    this.hostedView = !!this.worker;
    this.update({
      view,
      checkpointRecovery: undefined,
      ...(this.replicaLive || this.replicaStopped
        ? { synchronizing: false }
        : {}),
      pendingCampaign: undefined,
      waitingForHost: false,
      busy: false,
      pending: !!this.pending,
      error:
        terminalError ??
        (newReceipt &&
        (view.receipt?.error || acknowledged?.kind !== "activity")
          ? view.receipt?.error
          : this.state.error === CONNECTION_LOST
            ? undefined
            : this.state.error),
    });
    this.flushActivity();
    this.flushQueued();
    if (completed) {
      if (view.receipt?.error) completed.reject(new Error(view.receipt.error));
      else completed.resolve();
    }
  }
  private flushQueued() {
    while (
      !this.pending &&
      !this.closing &&
      !this.state.synchronizing &&
      !this.replicaStopped &&
      this.queued.length
    ) {
      const queued = this.queued.shift()!;
      this.completion = queued;
      this.sendCommand(queued.command);
    }
  }
  private hostActivity() {
    this.lastHostMessage = Date.now();
    if (this.state.waitingForHost) this.update({ waitingForHost: false });
  }
  private replicationStream(value: { matchId: string; epoch: string }) {
    return (
      !!this.replicaStream &&
      this.replicaStream.matchId === value.matchId &&
      this.replicaStream.epoch === value.epoch
    );
  }
  private stopReplica() {
    this.replicaGeneration++;
    this.replica?.terminate();
    this.replica = undefined;
    this.replicaOpening = undefined;
    this.replicaProgress = undefined;
    this.replicaQueue = Promise.resolve();
    this.replicaQueuedRecords = this.replicaQueuedBytes = 0;
    this.pendingScenarioBaseline = undefined;
    this.pendingScenarioRecords = [];
    this.replicaLive = false;
    this.replicaStopped = undefined;
    this.replicaDisconnected = [];
  }
  private acceptBaseline(baseline: ReplicaBaseline) {
    const stopped = this.replicaStopped;
    if (!this.replicationStream(baseline)) this.stopReplica();
    this.replicaStream = {
      matchId: baseline.matchId,
      epoch: baseline.epoch,
    };
    this.pendingScenarioBaseline = undefined;
    this.pendingScenarioRecords = [];
    this.hostActivity();
    this.replicaLive = false;
    this.replicaStopped = undefined;
    this.replicaProgress = undefined;
    this.update({
      synchronizing: true,
      ...(stopped ? { error: undefined } : {}),
    });
    const pinned =
      this.state.scenarioSnapshot ??
      (!this.state.browse?.mod ? this.receivedScenario?.scenario : undefined);
    if (
      (baseline.world.spec.customScenario?.mod || this.state.browse?.mod) &&
      !pinned
    ) {
      this.pendingScenarioBaseline = baseline;
      return;
    }
    this.toReplica({
      kind: "baseline",
      baseline,
      seat: this.state.lobby.selfId!,
      scenario: pinned,
    });
  }
  private toReplica(request: ReplicaRequest) {
    const generation = this.replicaGeneration;
    const records = request.kind === "records" ? request.records.length : 0;
    const bytes =
      request.kind === "records"
        ? new TextEncoder().encode(JSON.stringify(request)).length
        : 0;
    if (
      !this.replica &&
      (this.replicaQueuedRecords + records > 1024 ||
        this.replicaQueuedBytes + bytes > 4 * 1024 * 1024)
    ) {
      this.requestReplicaResync("Replica loading buffer overflow");
      return;
    }
    this.replicaQueuedRecords += records;
    this.replicaQueuedBytes += bytes;
    this.replicaQueue = this.replicaQueue
      .then(async () => {
        if (generation !== this.replicaGeneration) return;
        if (!this.replicaOpening) {
          this.replicaOpening = (async () => {
            const worker = await this.replicaFactory();
            if (generation !== this.replicaGeneration) {
              worker.terminate();
              return;
            }
            this.replica = worker;
            worker.onmessage = ({ data }: MessageEvent<ReplicaResponse>) => {
              if (
                generation !== this.replicaGeneration ||
                this.replica !== worker
              )
                return;
              if (data.kind === "views") {
                const view = data.views[this.state.lobby.selfId!];
                if (
                  view &&
                  (this.replicaLive || this.replicaStopped) &&
                  this.replicationStream(view)
                ) {
                  view.disconnected = [...this.replicaDisconnected];
                  this.acceptView(view);
                }
                worker.postMessage({
                  kind: "views-applied",
                } satisfies ReplicaRequest);
              } else if (data.kind === "progress") {
                if (!this.replicationStream(data)) return;
                const { matchId, epoch, applied, verified } = data;
                this.replicaProgress =
                  data.state === "live"
                    ? { matchId, epoch, applied, verified }
                    : undefined;
                this.replicaLive = data.state === "live";
                if (data.state === "stopped")
                  this.replicaStopped =
                    data.error || "The shared simulation stopped";
                this.update({
                  synchronizing:
                    data.state === "stopped"
                      ? false
                      : data.state !== "live" || !!this.state.synchronizing,
                  ...(this.replicaStopped
                    ? { error: this.replicaStopped, waitingForHost: false }
                    : data.error
                      ? { error: data.error }
                      : {}),
                });
              } else {
                this.replicaLive = false;
                this.update({ synchronizing: true });
                this.requestReplicaResync(data.reason);
              }
            };
            worker.onerror = () => {
              if (generation !== this.replicaGeneration) return;
              this.stopReplica();
              this.update({
                synchronizing: true,
                error: "The replica worker stopped. Reconnect to synchronize.",
              });
            };
            return worker;
          })();
        }
        const worker = await this.replicaOpening;
        if (generation === this.replicaGeneration) {
          this.replicaQueuedRecords -= records;
          this.replicaQueuedBytes -= bytes;
          worker?.postMessage(request);
        }
      })
      .catch((error: Error) => {
        if (generation === this.replicaGeneration) {
          if (!this.replica) {
            this.replicaOpening = undefined;
            this.replicaQueuedRecords -= records;
            this.replicaQueuedBytes -= bytes;
          }
          this.update({ synchronizing: true, error: error.message });
        }
      });
  }
  private requestReplicaResync(reason: string) {
    if (!this.replicaStream || Date.now() - this.lastReplicaResync < 2000)
      return;
    this.lastReplicaResync = Date.now();
    void this.request({
      kind: "send",
      to: this.state.lobby.hostId!,
      payload: {
        kind: "resync",
        matchId: this.replicaStream.matchId,
        epoch: this.replicaStream.epoch,
        applied: this.replicaProgress?.applied ?? 0,
        reason,
      },
    }).catch(() => undefined);
  }
  private disconnectedSeats() {
    return (
      this.state.view?.grids
        .filter(
          (grid) =>
            !grid.retired &&
            grid.seat.id !== this.state.lobby.selfId &&
            !this.state.lobby.connected.includes(grid.seat.id),
        )
        .map((grid) => grid.seat.id) ?? []
    );
  }
  private sendMembership() {
    if (!this.worker || !this.state.view) return;
    this.post({
      kind: "replica-peers",
      connected: [...this.state.lobby.connected],
    });
    const { matchId, epoch, revision } = this.state.view;
    for (const id of this.state.lobby.connected)
      if (id !== this.state.lobby.selfId)
        this.sendReplication(id, {
          kind: "keepalive",
          matchId,
          epoch,
          revision,
          disconnected: this.disconnectedSeats(),
        });
  }
  private forgetReplicationConnection(to: string) {
    this.replicationConnections.delete(to);
    this.replicationSends.delete(to);
    this.outboundScenario.delete(to);
  }
  /** The shell's scenario send participates in the same order as all subsequent replica traffic. */
  private sendReplication(to: string, payload: WireMessage) {
    if (!this.state.lobby.connected.includes(to)) return;
    const generation = this.startGeneration;
    const connection = this.replicationConnections.get(to) ?? {};
    this.replicationConnections.set(to, connection);
    const current = () =>
      generation === this.startGeneration &&
      connection === this.replicationConnections.get(to) &&
      !!this.worker &&
      this.state.lobby.connected.includes(to);
    const send = (this.replicationSends.get(to) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        if (!current()) return;
        if (payload.kind === "baseline") {
          const scenario = payload.world.spec.customScenario;
          const digest = scenario?.mod?.runtimeDigest;
          if (digest && scenario && this.outboundScenario.get(to) !== digest) {
            const summary = modBrowseSummary(scenario);
            const key = selectionKey({
              session: "match",
              revision: 0,
              phase: "playing",
              card: "MODS",
              difficulty: summary.difficulty,
              mod: summary,
            });
            await this.request({
              kind: "send",
              to,
              payload: { kind: "scenario", selectionKey: key, scenario },
            });
            if (!current()) return;
            this.outboundScenario.set(to, digest);
          }
        }
        await this.request({ kind: "send", to, payload });
        if (this.onlineCampaigns && current() && payload.kind === "baseline")
          this.post({
            kind: "baseline-dispatched",
            to,
            index: payload.index,
            delivered: true,
          });
      });
    this.replicationSends.set(to, send);
    void send.catch((error: unknown) => {
      // The transport's disconnect notice can follow this rejected send.
      // A baseline on that dead channel would only spend the replica's recovery budget.
      if (current() && !(error instanceof PeerDisconnectedError)) {
        if (this.onlineCampaigns && payload.kind === "baseline")
          this.post({
            kind: "baseline-dispatched",
            to,
            index: payload.index,
            delivered: false,
          });
        else this.post({ kind: "baseline", to });
      }
    });
  }
  /** Menu transitions cannot be dropped while a purchase or another command is in flight. */
  setActivity(reason: string | null) {
    this.activity = reason;
    this.flushActivity();
  }
  dismissError() {
    this.update({
      error: undefined,
      lobby: { ...this.state.lobby, error: undefined },
    });
  }
  private flushActivity() {
    const own = this.state.view?.grids.find(
      (g) => g.seat.id === this.state.lobby.selfId,
    );
    if (
      own &&
      (own.pauseReason ?? null) !== this.activity &&
      !this.pending &&
      !this.state.synchronizing &&
      !this.replicaStopped &&
      !this.closing
    )
      this.sendCommand({ kind: "activity", reason: this.activity });
  }
  /** Companies still playing must all be here; a retired company's player may be gone. */
  private everyoneConnected() {
    return !this.state.view?.grids.some(
      (g) =>
        !g.retired &&
        g.seat.id !== this.state.lobby.selfId &&
        !this.state.lobby.connected.includes(g.seat.id),
    );
  }
  private transmit() {
    if (
      !this.pending ||
      this.replicaStopped ||
      !this.authorityIsCurrent(this.pending.epoch)
    )
      return;
    // A guest whose host link is down cannot deliver anything. The command stays pending and the
    // pump resends it once the link returns; the lost connection is already reported once, so
    // each retry must not raise another error.
    const { hostId, connected } = this.state.lobby;
    if (!this.worker && !(hostId && connected.includes(hostId))) return;
    this.lastSend = Date.now();
    if (this.worker)
      this.post({
        kind: "command",
        sender: this.state.lobby.selfId!,
        envelope: this.pending,
        allowReady: this.everyoneConnected(),
      });
    else
      void this.request({
        kind: "send",
        to: this.state.lobby.hostId!,
        payload: { kind: "command", envelope: this.pending },
      }).catch((error: Error) => {
        // The link dropped between the last lobby update and this send. Its disconnect notice
        // follows, and the command is resent on reconnect, so it is not a new failure.
        if (!(error instanceof PeerDisconnectedError))
          this.update({ error: error.message });
      });
  }
  command(command: Command) {
    void this.submit(command).catch((error) =>
      this.update({ error: error.message }),
    );
  }
  submit(command: Command): Promise<void> {
    if (command.kind === "action" && command.name === "buildFacility") {
      const payload = command.payload as {
        facility: FacilityShoppingType;
        financed: boolean;
        territoryId?: TerritoryId;
        tileId?: TerritoryTileId;
        reviewKey?: string;
      };
      const { name, peakW, peakWh, gasCycle, resilience } = payload.facility;
      command = {
        ...command,
        payload: {
          facility: { name, peakW, peakWh, gasCycle, resilience },
          financed: payload.financed,
          ...(payload.territoryId !== undefined && {
            territoryId: payload.territoryId,
          }),
          ...(payload.tileId !== undefined && { tileId: payload.tileId }),
          ...(payload.reviewKey !== undefined && {
            reviewKey: payload.reviewKey,
          }),
        },
      };
    }
    if (this.replicaStopped)
      return Promise.reject(new Error(this.replicaStopped));
    if (this.state.synchronizing)
      return Promise.reject(new Error("Synchronizing with host…"));
    if (!this.state.view || this.closing)
      return Promise.reject(new Error("No shared game is running"));
    if (this.queued.length >= MAX_QUEUED_COMMANDS)
      return Promise.reject(
        new Error("Wait for the host to accept your commands"),
      );
    return new Promise<void>((resolve, reject) => {
      if (this.pending) this.queued.push({ command, resolve, reject });
      else {
        this.completion = { resolve, reject };
        this.sendCommand(command);
      }
    });
  }
  private sendCommand(command: Command) {
    const { view } = this.state;
    if (
      !view ||
      this.pending ||
      this.closing ||
      this.state.synchronizing ||
      this.replicaStopped
    )
      return;
    if (command.kind === "ready" && view.disconnected.length) {
      const error = new Error("Wait for every player to reconnect");
      this.completion?.reject(error);
      this.completion = undefined;
      this.update({ error: error.message });
      return;
    }
    this.pending = {
      matchId: view.matchId,
      epoch: view.epoch,
      sequence: ++this.sequence,
      command,
    };
    this.update({
      pending: true,
      ...(command.kind !== "activity" && { error: undefined }),
    });
    this.transmit();
  }
  async create() {
    this.campaignGeneration++;
    this.update({
      busy: true,
      entryOperation: "create",
      error: undefined,
      pendingCampaign: undefined,
    });
    try {
      this.update({
        lobby: await this.request({
          kind: "create",
          rules: manifest.multiplayerCompatibilityId,
        }),
      });
    } finally {
      this.update({ busy: false, entryOperation: undefined });
    }
  }
  async join(lobbyId: string) {
    this.campaignGeneration++;
    this.clearLobbySelection();
    const { lobbyId: previousLobbyId, available, selfId } = this.state.lobby;
    this.departingLobbyId = previousLobbyId;
    this.update({
      lobby: { available, selfId, members: [], connected: [] },
      busy: true,
      entryOperation: "join",
      error: undefined,
      pendingCampaign: undefined,
      browse: undefined,
      scenarioSnapshot: undefined,
    });
    try {
      this.update({
        lobby: await this.request({
          kind: "join",
          rules: manifest.multiplayerCompatibilityId,
          lobbyId,
        }),
      });
    } finally {
      const interruptedLobbyId = this.interruptedJoinLobbyId;
      this.interruptedJoinLobbyId = undefined;
      this.departingLobbyId = undefined;
      if (interruptedLobbyId && interruptedLobbyId === this.state.lobby.lobbyId)
        void this.hostLeft();
      this.update({ busy: false, entryOperation: undefined });
    }
  }
  async reconnect(roomId?: string) {
    if (!roomId && this.state.view && !this.worker) {
      // A successful service request precedes the first usable message from the host.
      this.lastHostMessage = -Infinity;
      this.update({ waitingForHost: true });
    }
    try {
      const lobby = await this.request({
        kind: "reconnect",
        ...(roomId && { roomId }),
      });
      this.update({ error: undefined });
      this.event({ kind: "state", state: lobby });
    } catch (error) {
      // Keep a failed retry in the connection notice so the player can try again.
      this.update({
        error: undefined,
        lobby: {
          ...this.state.lobby,
          error: error instanceof Error ? error.message : "Could not reconnect",
        },
      });
      if (roomId) throw error;
    }
  }
  async approve(requestId: string, approve: boolean) {
    this.update({
      lobby: await this.request({ kind: "approve", requestId, approve }),
    });
  }
  async removePlayer(seatId: string) {
    this.update({ lobby: await this.request({ kind: "remove", seatId }) });
  }
  async exportSave(id?: string) {
    if (!this.services.checkpoints.export)
      throw new Error("Multiplayer export is unavailable.");
    await this.services.checkpoints.export(id);
  }
  async rotateInvite() {
    this.update({ lobby: await this.request({ kind: "rotate-invite" }) });
  }
  hasOnlineAuthority() {
    return !!this.services.authority?.();
  }
  canLeaveInterruption() {
    const { lobby, view, checkpointRecovery } = this.state;
    return (
      !!checkpointRecovery ||
      (!this.worker &&
        !this.isHost() &&
        (view ? !this.hostedView : !!lobby.selfId && !!lobby.hostId))
    );
  }
  hasStoppedReplica() {
    return !!this.replicaStopped;
  }
  canRecover() {
    const { campaignLocked, recoveryAvailable, members, requiredPlayers } =
      this.state.lobby;
    const required = requiredPlayers ?? members.map(({ id }) => id);
    return (
      !!campaignLocked &&
      !!recoveryAvailable &&
      this.isHost() &&
      !this.state.busy &&
      this.authorityIsCurrent() &&
      required.every(
        (id) =>
          id === this.state.lobby.selfId ||
          this.state.lobby.connected.includes(id),
      )
    );
  }
  recover() {
    return this.start({ recovery: true });
  }
  /** Reloads the multiplayer saves; only the newest request may replace the list. */
  async refreshSaves(sync = true) {
    return this.loadLibrary(() => this.services.checkpoints.list(sync));
  }
  private async loadLibrary(read: () => Promise<SharedSaveLibrary>) {
    const request = ++this.libraryRequest;
    this.update({ loadingSaves: true });
    try {
      const library = await read();
      if (request === this.libraryRequest) this.update({ library });
      return library;
    } finally {
      if (request === this.libraryRequest) this.update({ loadingSaves: false });
    }
  }
  async deleteSharedSave(id: string) {
    const library = await this.loadLibrary(() =>
      this.services.checkpoints.remove(id),
    );
    if (this.state.pendingCampaign?.id === id) {
      this.campaignGeneration++;
      this.update({ pendingCampaign: undefined });
      this.sendCampaign(undefined, true);
    }
    return library;
  }
  /** Selecting a campaign opens its invitation lobby before starting any saved grids. */
  async prepareResume(id: string, name: string) {
    if (this.onlineCampaigns) {
      await this.reconnect(id);
      if (
        this.isHost() &&
        !this.worker &&
        this.state.lobby.campaignLocked &&
        !this.state.lobby.recoveryAvailable
      )
        this.event({
          kind: "state",
          state: await this.request({ kind: "restart-host" }),
        });
      return;
    }
    const generation = ++this.campaignGeneration;
    const lifecycle = this.lifecycle;
    const current = () =>
      generation === this.campaignGeneration && lifecycle === this.lifecycle;
    this.update({ busy: true, error: undefined });
    try {
      const world = await this.services.checkpoints.read(id);
      if (!current()) return;
      if (!world) throw new Error("This multiplayer save could not be found");
      if (!Array.isArray(world.seats))
        throw new Error("This multiplayer save could not be read");
      const players = world.seats.map((seat) => ({
        ...seat,
        name:
          seat?.name === undefined ||
          (typeof seat.name === "string" &&
            seat.name.length <= 200 &&
            !seat.name.trim())
            ? seat?.id
            : seat.name,
      }));
      const campaign: PendingCampaign = {
        id,
        name,
        players,
        requiredPlayerIds: players
          .filter((seat) => !world.outcomes?.[seat.id])
          .map((seat) => seat.id),
      };
      if (!validPendingCampaign(campaign))
        throw new Error("This multiplayer save could not be read");
      if (this.state.lobby.lobbyId && !this.isHost())
        throw new Error("Only the host can choose a save");
      if (!this.state.lobby.lobbyId) {
        const lobby = await this.request({
          kind: "create",
          rules: manifest.multiplayerCompatibilityId,
        });
        if (!current()) return;
        this.update({ lobby });
      }
      clearTimeout(this.browseTimer);
      this.browseTimer = undefined;
      this.publishedSelection = undefined;
      this.update({ pendingCampaign: campaign, browse: undefined });
      this.sendCampaign();
    } finally {
      if (current()) this.update({ busy: false });
    }
  }
  /** The host sets the saved campaign aside to choose a new game instead. */
  cancelCampaign() {
    if (!this.isHost() || !this.state.pendingCampaign) return;
    this.campaignGeneration++;
    this.update({ pendingCampaign: undefined });
    this.sendCampaign(undefined, true);
  }
  /** Takes one saved company for this player; Steam shares the claim with the lobby. */
  async claimSlot(seatId: string) {
    const campaign = this.state.pendingCampaign;
    if (!campaign) return;
    this.update({
      lobby: await this.request({
        kind: "member",
        key: "slot",
        value: slotClaim(campaign.id, seatId),
      }),
    });
  }
  /** Why the lobby cannot resume its saved campaign yet. */
  resumeBlocker() {
    const campaign = this.state.pendingCampaign;
    if (!campaign) return "Choose a multiplayer save";
    const { members, connected, selfId } = this.state.lobby;
    return resumeBlocker(
      campaign,
      members,
      (id) => id === selfId || connected.includes(id),
    );
  }
  canResumeCampaign() {
    return this.isHost() && !this.resumeBlocker();
  }
  private rosterError(seats: Seat[], required: Seat[]) {
    const { members, connected, selfId } = this.state.lobby;
    if (seats.length < 2) return "Invite a friend to play together";
    if (required.some((s) => s.id !== selfId && !connected.includes(s.id)))
      return "Every player in this match must be connected";
    const ids = new Set(seats.map((s) => s.id));
    if (
      members.some((member) => !ids.has(member.id)) ||
      required.some((seat) => !members.some((m) => m.id === seat.id))
    )
      return "The lobby must contain only the saved match's players";
  }
  /** Starts the host's chosen scenario for the lobby, or resumes the last multiplayer save. */
  async start(
    choice:
      { spec: MatchSpec } | { saved: true; id?: string } | { recovery: true },
  ) {
    const recovery = "recovery" in choice;
    if (recovery && !this.canRecover())
      throw new Error(
        "Wait for the original players to connect before recovering.",
      );
    const generation = ++this.startGeneration;
    const lifecycle = this.lifecycle;
    const current = () =>
      generation === this.startGeneration && lifecycle === this.lifecycle;
    let locked = false;
    let receivedView = false;
    const rollback = (message: string) => {
      if (!current()) return;
      this.startGeneration++;
      this.worker?.terminate();
      this.worker = undefined;
      this.update({ busy: false, error: message });
      const browse = this.state.browse;
      if (browse)
        this.publishBrowse({
          phase: "browsing",
          card: browse.card,
          scenarioId: browse.scenarioId,
          difficulty: browse.difficulty,
          custom: browse.custom,
          mod: browse.mod,
          scenarioSnapshot: this.state.scenarioSnapshot,
        });
      if (locked)
        this.startupCleanup = this.request({ kind: "unlock" }).catch(
          () => undefined,
        );
    };
    this.update({ busy: true, error: undefined });
    try {
      // A retry must acquire its lock after the failed attempt releases its own.
      await this.startupCleanup;
      if (!current()) return;
      const world =
        "saved" in choice || recovery
          ? await this.services.checkpoints.read(
              "saved" in choice ? choice.id : undefined,
            )
          : null;
      if (("saved" in choice || recovery) && !world)
        throw new Error("No multiplayer save on this computer yet");
      const checkpointSource = world
        ? {
            matchId: world.matchId,
            epoch: world.epoch,
            revision: world.revision,
          }
        : undefined;
      const { members } = this.state.lobby;
      if ("spec" in choice && choice.spec.customScenario?.mod) {
        const browse = this.state.browse;
        if (
          !browse?.mod ||
          !validSelectedMod(browse.mod, choice.spec.customScenario) ||
          choice.spec.difficulty !== browse.difficulty ||
          members.some(
            (member) =>
              member.id !== this.state.lobby.selfId &&
              member.ready !== selectionKey(browse),
          )
        )
          throw new Error(
            "Wait for every player to receive the scenario and mark Ready.",
          );
      }
      const campaign = this.state.pendingCampaign;
      if (
        world &&
        !recovery &&
        (!campaign || !("saved" in choice) || campaign.id !== choice.id)
      )
        throw new Error("Choose the multiplayer save again");
      // A resumed match hands each saved company to whoever claimed it; retired ones may stay away.
      const seats = world
        ? recovery
          ? world.seats
          : resumeSeats(campaign!, members)
        : members.map(({ id, name }) => ({ id, name }));
      const requiredSeats = seats.filter(
        (_, index) => !world?.outcomes?.[world.seats[index].id],
      );
      const rosterError =
        world && !recovery
          ? this.resumeBlocker()
          : this.rosterError(seats, requiredSeats);
      if (rosterError) throw new Error(rosterError);
      if (!recovery) {
        await this.request({
          kind: "lock",
          ids: seats.map((seat) => seat.id),
          requiredIds: requiredSeats.map((seat) => seat.id),
        });
        locked = true;
      }
      if (!current()) {
        await this.request({ kind: "unlock" }).catch(() => undefined);
        return;
      }
      // A previous start can fail inside the worker; never leave that thread running.
      this.outboundScenario.clear();
      this.worker?.terminate();
      const worker = await this.workerFactory();
      if (!current()) {
        worker.terminate();
        return;
      }
      const onlineAuthority = this.services.authority?.();
      if (this.services.authority && (!onlineAuthority || !this.isHost())) {
        worker.terminate();
        throw new Error("Host authority expired. Reconnect to continue.");
      }
      const epoch = onlineAuthority?.epoch ?? crypto.randomUUID();
      this.worker = worker;
      this.relayAuthority();
      let checkpointReady = !this.onlineCampaigns;
      let initialCheckpoint = !checkpointReady;
      let initialView: RoomView | undefined;
      this.connected = new Set(this.state.lobby.connected);
      this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (!current() || this.worker !== worker) return;
        if (data.kind === "error") {
          if (!receivedView) rollback(data.message);
          else this.update({ error: data.message, busy: false });
          return;
        }
        if (data.kind === "checkpoint") {
          const first = initialCheckpoint;
          initialCheckpoint = false;
          this.saving = this.saving
            .catch(() => {})
            .then(async () => {
              if (!current() || !this.authorityIsCurrent(data.world.epoch)) {
                if (first || data.requestId)
                  throw new Error(
                    "Host authority changed before the checkpoint could be saved.",
                  );
                return;
              }
              await this.services.checkpoints.write(
                data.world,
                checkpointSource,
                !!data.requestId,
              );
              if (data.requestId && !current())
                throw new Error(
                  "Host changed while the checkpoint was being saved.",
                );
            });
          void this.saving.then(
            () => {
              if (!current() || !first) return;
              checkpointReady = true;
              if (initialView) {
                receivedView = true;
                this.acceptView(initialView);
              }
              this.relayAuthority();
              this.post({
                kind: "replication-open",
                connected: [...this.state.lobby.connected],
              });
            },
            (error) => {
              if (!current()) return;
              const message = `Multiplayer save failed: ${error.message}`;
              if (first) rollback(message);
              else this.update({ error: message });
            },
          );
          if (data.requestId) {
            const request = this.saveRequests.get(data.requestId);
            void this.saving.then(
              () => request?.resolve(),
              (error) => request?.reject(error),
            );
          }
          return;
        }
        if (data.kind === "summary") return;
        if (data.kind === "records") {
          if (!checkpointReady || !this.authorityIsCurrent(data.epoch)) return;
          for (const id of this.state.lobby.connected)
            if (id !== this.state.lobby.selfId) this.sendReplication(id, data);
          return;
        }
        if (data.kind === "baseline") {
          if (checkpointReady && this.authorityIsCurrent(data.baseline.epoch))
            this.sendReplication(data.to, {
              kind: "baseline",
              ...data.baseline,
            });
          return;
        }
        if (data.kind === "rejected") {
          const { to, ...payload } = data;
          if (
            to === this.state.lobby.selfId &&
            this.pending?.sequence === payload.sequence
          ) {
            this.completion?.reject(new Error(payload.error));
            this.completion = undefined;
            this.pending = undefined;
            this.sequence = this.state.view?.lastSequence ?? 0;
            this.update({ pending: false, error: payload.error });
            this.flushQueued();
          } else this.sendReplication(to, payload);
          return;
        }
        if (data.kind === "keepalive") {
          if (!checkpointReady || !this.authorityIsCurrent(data.epoch)) return;
          for (const id of this.state.lobby.connected)
            if (id !== this.state.lobby.selfId)
              void this.request({
                kind: "send",
                to: id,
                payload: { ...data, disconnected: this.disconnectedSeats() },
              }).catch(() => this.post({ kind: "disconnect", sender: id }));
          return;
        }
        if (data.kind !== "views") return;
        const view = data.views[this.state.lobby.selfId!];
        if (view) {
          view.disconnected = view.grids
            .filter(
              (grid) =>
                !grid.retired &&
                grid.seat.id !== this.state.lobby.selfId &&
                !this.state.lobby.connected.includes(grid.seat.id),
            )
            .map((grid) => grid.seat.id);
          if (checkpointReady) {
            receivedView = true;
            this.acceptView(view);
          } else initialView = view;
          if (current() && this.worker === worker)
            this.post({
              kind: "replica-peers",
              connected: [...this.state.lobby.connected],
            });
        }
        // Subscribers apply the host grid synchronously. Only then may the worker clone
        // another bundle; small clock/liveness messages remain independent of this credit.
        if (current() && this.worker === worker)
          this.post({ kind: "views-applied" });
      };
      this.worker.onerror = () => {
        if (!current() || this.worker !== worker) return;
        const error =
          "The simulation worker stopped. Resume the multiplayer save to continue.";
        if (!receivedView) rollback(error);
        else this.update({ busy: false, error });
      };
      this.post(
        world
          ? {
              kind: "restore",
              world,
              epoch,
              online: this.onlineCampaigns,
              seats,
              hostSeat: this.state.lobby.selfId!,
            }
          : {
              kind: "create",
              spec: (choice as { spec: MatchSpec }).spec,
              seats,
              matchId: crypto.randomUUID(),
              epoch,
              online: this.onlineCampaigns,
              hostSeat: this.state.lobby.selfId!,
            },
      );
    } catch (error) {
      rollback(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  async save(pause = false, keepOpen = false, suspended = keepOpen) {
    if (suspended) {
      // Unsent pre-sleep readiness cannot count as fresh consent after the safety checkpoint.
      // Already sent envelopes keep their sequence/receipt identity and precede the checkpoint.
      this.queued = this.queued.filter((queued) => {
        const { command } = queued;
        if (
          command.kind !== "ready" &&
          !(command.kind === "speed" && command.speed !== "PAUSED")
        )
          return true;
        queued.reject(
          new Error(
            "The device went to sleep. Choose a speed again when ready.",
          ),
        );
        return false;
      });
    }
    if (!this.worker) {
      if (!this.state.view) return;
      const requestId = crypto.randomUUID();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          this.saveRequests.set(requestId, { resolve, reject });
          timer = setTimeout(
            () => reject(new Error("The host could not finish the save")),
            this.onlineCampaigns
              ? ONLINE_SAVE_TIMEOUT_MS + HOST_SILENCE_MS
              : SAVE_TIMEOUT_MS,
          );
          void this.request({
            kind: "send",
            to: this.state.lobby.hostId!,
            payload: {
              kind: "save-request",
              requestId,
              ...(suspended ? { suspended: true } : {}),
              ...(pause && this.onlineCampaigns && { pause: true }),
            },
          }).catch(reject);
        });
      } finally {
        clearTimeout(timer);
        this.saveRequests.delete(requestId);
      }
      return;
    }
    if (pause && !keepOpen) this.closing = true;
    const requestId = crypto.randomUUID();
    let timeout: ReturnType<typeof setTimeout>;
    try {
      await new Promise<void>((resolve, reject) => {
        this.saveRequests.set(requestId, { resolve, reject });
        timeout = setTimeout(
          () => reject(new Error("The host could not finish the save")),
          this.onlineCampaigns ? ONLINE_SAVE_TIMEOUT_MS : SAVE_TIMEOUT_MS,
        );
        this.post({
          kind: "checkpoint",
          requestId,
          pause,
          ...(suspended ? { suspended: true } : {}),
        });
      });
    } catch (error) {
      if (pause && !keepOpen) this.closing = false;
      throw error;
    } finally {
      clearTimeout(timeout!);
      this.saveRequests.delete(requestId);
    }
  }
  private clearLobbySelection() {
    clearTimeout(this.browseTimer);
    this.browseTimer = undefined;
    this.browseSession = undefined;
    this.publishedSelection = undefined;
    this.browsePeers = new Set();
    this.receivedScenario = undefined;
    this.outboundScenario.clear();
  }
  /**
   * Saves, then leaves the match: the host checkpoints its world and a guest waits for the
   * host's save. skipSave keeps the last multiplayer save instead, so a player can always leave a
   * match whose host is gone.
   */
  async leave({ skipSave = false }: { skipSave?: boolean } = {}) {
    this.campaignGeneration++;
    this.closing = true;
    try {
      if (!skipSave) await this.save(!!this.worker || this.onlineCampaigns);
    } catch (error) {
      // The player stays in the match to retry or to leave without saving.
      this.closing = false;
      throw error;
    }
    this.startGeneration++;
    this.worker?.terminate();
    this.worker = undefined;
    this.stopReplica();
    this.replicaStream = undefined;
    this.replicationSends.clear();
    this.replicationConnections.clear();
    this.pending = undefined;
    this.completion?.reject(new Error("You left the shared game"));
    this.queued.forEach((q) => q.reject(new Error("You left the shared game")));
    this.completion = undefined;
    this.queued = [];
    this.activity = null;
    this.sequence = 0;
    try {
      await this.request({ kind: "leave" });
    } catch {
      // Best effort: the local match has ended and its save is written. Native create and join
      // leave any stale lobby first, so this is cleaned up when the next match starts.
    } finally {
      // Forget the departed lobby before reopening, so a late host update cannot revive it.
      this.clearLobbySelection();
      ++this.libraryRequest;
      this.update({
        browse: undefined,
        scenarioSnapshot: undefined,
        pendingCampaign: undefined,
        library: undefined,
        loadingSaves: false,
        lobby: {
          ...this.state.lobby,
          lobbyId: undefined,
          inviteCode: undefined,
          hostId: undefined,
          members: [],
          connected: [],
        },
        view: undefined,
        checkpointRecovery: undefined,
        error: undefined,
        pending: false,
        busy: false,
        waitingForHost: false,
        synchronizing: false,
      });
      this.closing = false;
    }
  }
  private handleHostLeft() {
    // Let the native join settle before issuing a leave for the new room.
    if (this.state.entryOperation === "join")
      this.interruptedJoinLobbyId = this.state.lobby.lobbyId;
    else void this.hostLeft();
  }
  /** The guest returns to the title screen, where the host's departure is explained. */
  private async hostLeft() {
    await this.leave({ skipSave: true }).catch(() => undefined);
    this.update({ error: HOST_LEFT });
  }
  private isHost() {
    const { lobbyId, hostId, selfId } = this.state.lobby;
    return !!lobbyId && !!hostId && hostId === selfId;
  }
  /**
   * The host mirrors what it is looking at. Changes coalesce to the view rate; an unchanged
   * selection is not resent except as the periodic catch-up.
   */
  publishBrowse(input: HostBrowseSelection) {
    if (!this.isHost()) return;
    const { scenarioSnapshot, ...selection } = input;
    const body = JSON.stringify(selection);
    if (body === this.publishedSelection) return;
    const next: BrowseState = {
      ...selection,
      session: this.browseSession ?? "pending",
      revision: this.browseRevision + 1,
    };
    if (
      !validBrowseState(next) ||
      (selection.mod &&
        (!scenarioSnapshot ||
          !validSelectedMod(selection.mod, scenarioSnapshot)))
    ) {
      this.update({ error: "This scenario selection could not be validated." });
      return;
    }
    this.publishedSelection = body;
    this.browseSession ??= crypto.randomUUID();
    this.update({
      pendingCampaign: undefined,
      scenarioSnapshot: selection.mod
        ? JSON.parse(JSON.stringify(scenarioSnapshot))
        : undefined,
      browse: {
        ...selection,
        session: this.browseSession,
        revision: ++this.browseRevision,
      },
    });
    this.browseTimer ??= setTimeout(() => {
      this.browseTimer = undefined;
      this.sendBrowse();
    }, VIEW_INTERVAL_MS);
  }
  private sendBrowse(to?: string[]) {
    const { browse, lobby } = this.state;
    if (!browse || !this.isHost()) return;
    this.lastBrowseSend = Date.now();
    for (const id of to ?? lobby.connected) {
      if (id === lobby.selfId) continue;
      void this.request({
        kind: "send",
        to: id,
        payload: { kind: "browse", browse },
      }).catch(() => {});
      const scenario = this.state.scenarioSnapshot;
      const selection = selectionKey(browse);
      if (
        browse.mod &&
        scenario &&
        this.outboundScenario.get(id) !== selection
      ) {
        this.outboundScenario.set(id, selection);
        void this.request({
          kind: "send",
          to: id,
          payload: { kind: "scenario", selectionKey: selection, scenario },
        }).catch(() => {
          if (this.outboundScenario.get(id) === selection)
            this.outboundScenario.delete(id);
        });
      }
    }
  }
  private sendCampaign(to?: string[], clear = false) {
    const { pendingCampaign, lobby } = this.state;
    if ((!pendingCampaign && !clear) || !this.isHost()) return;
    this.lastBrowseSend = Date.now();
    for (const id of to ?? lobby.connected)
      if (id !== lobby.selfId)
        void this.request({
          kind: "send",
          to: id,
          payload: { kind: "campaign", campaign: pendingCampaign },
        }).catch(() => {});
  }
  /** A guest follows only the newest valid selection from its own host. */
  private acceptBrowse(browse: unknown) {
    if (!validBrowseState(browse)) {
      this.update({
        error: "Your game is out of sync with the host. Reconnect to follow.",
      });
      return;
    }
    const previous = this.state.browse;
    if (
      previous &&
      previous.session === browse.session &&
      browse.revision <= previous.revision
    )
      return;
    if (!this.state.view) this.lastHostMessage = Date.now();
    // Back in the lobby after a match: the finished match's view goes, and the guest follows on.
    if (browse.phase === "browsing" && this.state.view) this.endLocalMatch();
    const received = this.receivedScenario;
    const snapshot =
      browse.mod &&
      received?.key === selectionKey(browse) &&
      validSelectedMod(browse.mod, received.scenario)
        ? received.scenario
        : undefined;
    this.update({
      browse,
      scenarioSnapshot: snapshot,
      pendingCampaign: undefined,
    });
    if (
      browse.mod &&
      !snapshot &&
      this.state.lobby.members.find(
        (member) => member.id === this.state.lobby.selfId,
      )?.ready
    )
      void this.setReady("").catch(() => undefined);
  }
  private acceptScenario(key: string, value: unknown) {
    if (
      typeof key !== "string" ||
      key.length > 256 ||
      !value ||
      typeof value !== "object"
    )
      return;
    const scenario = value as ScenarioType;
    if (!validScenarioMod(scenario.mod, scenario)) {
      this.update({
        error:
          "The host's scenario could not be validated. Ask the host to choose it again.",
      });
      return;
    }
    const summary = modBrowseSummary(scenario);
    const stamp = selectionKey({
      session: "snapshot",
      revision: 0,
      phase: "browsing",
      card: "MODS",
      difficulty: summary.difficulty,
      mod: summary,
    });
    if (key !== stamp) {
      this.update({
        error: "The host's scenario does not match the selected content.",
      });
      return;
    }
    const detached = JSON.parse(JSON.stringify(scenario)) as ScenarioType;
    this.receivedScenario = { key, scenario: detached };
    const browse = this.state.browse;
    if (
      browse?.mod &&
      selectionKey(browse) === key &&
      validSelectedMod(browse.mod, detached)
    )
      this.update({ scenarioSnapshot: detached, error: undefined });
    const baseline = this.pendingScenarioBaseline;
    if (
      baseline &&
      baseline.world.spec.customScenario?.mod?.runtimeDigest ===
        detached.mod?.runtimeDigest
    ) {
      const records = this.pendingScenarioRecords;
      this.pendingScenarioBaseline = undefined;
      this.pendingScenarioRecords = [];
      this.acceptBaseline(baseline);
      records.forEach((batch) => this.toReplica(batch));
    }
  }
  /** Marks Ready for exactly this selection; any later change by the host clears it. */
  async setReady(key: string) {
    const browse = this.state.browse;
    if (
      key &&
      (!browse ||
        key !== selectionKey(browse) ||
        (browse.mod && !this.state.scenarioSnapshot))
    )
      throw new Error("Receiving scenario…");
    this.update({
      lobby: await this.request({
        kind: "member",
        key: "ready",
        value: key,
      }),
    });
  }
  /** The host closes a finished match and reopens the lobby to choose the next game. */
  async backToLobby() {
    if (!this.isHost()) return;
    this.closing = true;
    try {
      if (this.worker) await this.save(true);
      await this.request({ kind: "unlock" });
      this.endLocalMatch();
    } finally {
      this.closing = false;
    }
  }
  private endLocalMatch() {
    this.stopReplica();
    this.replicaStream = undefined;
    this.replicationSends.clear();
    this.replicationConnections.clear();
    this.receivedScenario = undefined;
    this.outboundScenario.clear();
    this.startGeneration++;
    this.worker?.terminate();
    this.worker = undefined;
    this.pending = undefined;
    this.completion?.reject(new Error("The match ended"));
    this.queued.forEach((q) => q.reject(new Error("The match ended")));
    this.completion = undefined;
    this.queued = [];
    this.activity = null;
    this.sequence = 0;
    this.receiptSequence = 0;
    this.update({
      view: undefined,
      checkpointRecovery: undefined,
      pending: false,
      busy: false,
      waitingForHost: false,
      synchronizing: false,
    });
  }
  dispose() {
    this.stopReplica();
    this.replicaStream = undefined;
    this.replicationSends.clear();
    this.replicationConnections.clear();
    this.receivedScenario = undefined;
    this.outboundScenario.clear();
    clearTimeout(this.browseTimer);
    this.lifecycle++;
    this.campaignGeneration++;
    this.stopEvents?.();
    clearInterval(this.timer);
    this.worker?.terminate();
    this.worker = undefined;
    this.completion?.reject(new Error("The shared game closed"));
    this.queued.forEach((q) => q.reject(new Error("The shared game closed")));
    this.completion = undefined;
    this.pending = undefined;
    this.queued = [];
    this.saveRequests.forEach((request) =>
      request.reject(new Error("The shared game closed")),
    );
    this.saveRequests.clear();
  }
}
