import type { DesktopBridge } from "../Desktop";
import manifest from "../data/RunCompatibility.json";
import type {
  Command,
  CommandEnvelope,
  MatchSpec,
  RoomView,
  Seat,
  World,
} from "./Types";
import type {
  LobbyState,
  NativeEvent,
  NativeRequest,
  PendingCampaign,
  SharedSaveLibrary,
} from "./Native";
import type { WorkerRequest, WorkerResponse } from "./WorkerProtocol";
import { validBrowseState, type BrowseState } from "./Browse";
import { resumeBlocker, resumeSeats, slotClaim } from "./Slots";
import {
  BROWSE_RESEND_MS,
  COMMAND_RESEND_MS,
  HOST_SILENCE_MS,
  MAX_QUEUED_COMMANDS,
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

export interface SessionState {
  lobby: LobbyState;
  view?: RoomView;
  pending: boolean;
  busy: boolean;
  waitingForHost: boolean;
  error?: string;
  /** The scenario selection the lobby is browsing; the host authors it, guests follow it. */
  browse?: BrowseState;
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
  private receiptSequence = 0;
  private lastHostMessage = Date.now();
  private lastSend = 0;
  private connected = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private lifecycle = 0;
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
  constructor(
    private bridge: DesktopBridge,
    private workerFactory: () => Promise<Worker>,
  ) {}
  getSnapshot = () => this.state;
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
  private request(input: NativeRequest) {
    if (!this.bridge.multiplayerRequest)
      return Promise.reject(
        new Error("Update the desktop game to play online"),
      );
    return this.bridge.multiplayerRequest(input);
  }
  private post(input: WorkerRequest) {
    this.worker?.postMessage(input);
  }
  async initialize() {
    const lifecycle = ++this.lifecycle;
    this.stopEvents = this.bridge.onMultiplayerEvent?.((event) =>
      this.event(event),
    );
    const lobby = (await this.request({ kind: "state" })) as LobbyState;
    if (lifecycle !== this.lifecycle) return;
    this.update({ lobby });
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.worker) this.post({ kind: "heartbeat" });
      else if (
        this.state.lobby.hostId &&
        this.state.lobby.hostId !== this.state.lobby.selfId &&
        this.state.lobby.connected.includes(this.state.lobby.hostId)
      ) {
        void this.request({
          kind: "send",
          to: this.state.lobby.hostId,
          payload: { kind: "heartbeat" },
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
        !!this.state.view &&
        !this.worker &&
        !this.closing &&
        Date.now() - this.lastHostMessage > HOST_SILENCE_MS;
      if (waitingForHost !== this.state.waitingForHost)
        this.update({ waitingForHost });
    }, SESSION_PUMP_MS);
  }
  private event(event: NativeEvent) {
    if (event.kind === "state") {
      const { hostId, lobbyId, members } = event.state;
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
        void this.hostLeft();
        return;
      }
      this.update({ lobby: event.state });
      if (this.isHost()) {
        // A friend who just joined lands on the page the host is showing, straight away.
        const joined = event.state.connected.filter(
          (id) => !this.browsePeers.has(id),
        );
        this.browsePeers = new Set(event.state.connected);
        if (joined.length) {
          this.sendBrowse(joined);
          this.sendCampaign(joined);
        }
      }
      if (this.worker) {
        const now = new Set(event.state.connected);
        for (const id of this.connected)
          if (!now.has(id)) this.post({ kind: "disconnect", sender: id });
        const joined = [...now].some((id) => !this.connected.has(id));
        this.connected = now;
        // A reconnected client needs a fresh complete view, including paused command receipts.
        if (joined) this.post({ kind: "checkpoint" });
      }
    } else if (event.kind === "disconnected") {
      if (this.worker) this.post({ kind: "disconnect", sender: event.sender });
      // A friend leaving before the match begins is routine; only a guest loses its game.
      else if (this.isHost() || event.sender !== this.state.lobby.hostId)
        return;
      else if (!this.state.view) void this.hostLeft();
      else
        this.update({
          error:
            "Connection lost. Reconnect to continue, or resume the multiplayer save in a new lobby.",
        });
    } else if (event.kind === "message") {
      if (this.worker && event.payload.kind === "save-request") {
        const requestId = event.payload.requestId;
        const respond = (error?: string) =>
          this.request({
            kind: "send",
            to: event.sender,
            payload: { kind: "save-result", requestId, error },
          });
        void this.save()
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
        )
          this.update({
            pendingCampaign: event.payload.campaign,
            browse: undefined,
          });
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
        event.payload.kind === "view"
      )
        this.acceptView(event.payload.view);
      else if (
        !this.worker &&
        !this.closing &&
        !!this.state.lobby.lobbyId &&
        event.sender === this.state.lobby.hostId &&
        event.payload.kind === "keepalive"
      ) {
        const { view } = this.state;
        const pulse = event.payload;
        if (
          view &&
          pulse.matchId === view.matchId &&
          pulse.epoch === view.epoch &&
          Number.isSafeInteger(pulse.revision) &&
          pulse.revision >= view.revision
        ) {
          this.lastHostMessage = Date.now();
          if (this.state.waitingForHost) this.update({ waitingForHost: false });
        }
      }
    }
  }
  private acceptView(view: RoomView) {
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
    const newReceipt =
      view.receipt && view.receipt.sequence > this.receiptSequence;
    if (newReceipt) this.receiptSequence = view.receipt!.sequence;
    if (newReceipt && view.receipt?.error && !this.pending)
      this.sequence = view.lastSequence;
    else this.sequence = Math.max(this.sequence, view.lastSequence);
    this.update({
      view,
      pendingCampaign: undefined,
      waitingForHost: false,
      busy: false,
      pending: !!this.pending,
      error:
        newReceipt && (view.receipt?.error || acknowledged?.kind !== "activity")
          ? view.receipt?.error
          : this.state.error,
    });
    this.flushActivity();
    while (!this.pending && !this.closing && this.queued.length) {
      const queued = this.queued.shift()!;
      this.completion = queued;
      this.sendCommand(queued.command);
    }
    if (completed) {
      if (view.receipt?.error) completed.reject(new Error(view.receipt.error));
      else completed.resolve();
    }
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
    if (!this.pending) return;
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
      }).catch((error) => this.update({ error: error.message }));
  }
  command(command: Command) {
    void this.submit(command).catch((error) =>
      this.update({ error: error.message }),
    );
  }
  submit(command: Command): Promise<void> {
    if (command.kind === "action" && command.name === "buildFacility") {
      const payload = command.payload as {
        facility: import("../Types").FacilityShoppingType;
        financed: boolean;
      };
      const { name, peakW, peakWh, gasCycle, resilience } = payload.facility;
      command = {
        ...command,
        payload: {
          facility: { name, peakW, peakWh, gasCycle, resilience },
          financed: payload.financed,
        },
      };
    }
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
    if (!view || this.pending || this.closing) return;
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
    this.update({ busy: true, error: undefined, pendingCampaign: undefined });
    try {
      this.update({
        lobby: (await this.request({
          kind: "create",
          rules: manifest.multiplayerCompatibilityId,
        })) as LobbyState,
      });
    } finally {
      this.update({ busy: false });
    }
  }
  async join(lobbyId: string) {
    this.campaignGeneration++;
    this.update({ busy: true, error: undefined, pendingCampaign: undefined });
    try {
      this.update({
        lobby: (await this.request({
          kind: "join",
          rules: manifest.multiplayerCompatibilityId,
          lobbyId,
        })) as LobbyState,
      });
    } finally {
      this.update({ busy: false });
    }
  }
  async invite() {
    await this.request({ kind: "invite" });
  }
  async reconnect() {
    this.update({
      lobby: (await this.request({ kind: "reconnect" })) as LobbyState,
      error: undefined,
    });
  }
  /** Reloads the multiplayer saves; only the newest request may replace the list. */
  async refreshSaves(sync = true) {
    return this.loadLibrary(
      () =>
        this.request({
          kind: "list-saves",
          sync,
        }) as Promise<SharedSaveLibrary>,
    );
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
    const library = await this.loadLibrary(
      () =>
        this.request({ kind: "delete-save", id }) as Promise<SharedSaveLibrary>,
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
    const generation = ++this.campaignGeneration;
    const lifecycle = this.lifecycle;
    const current = () =>
      generation === this.campaignGeneration && lifecycle === this.lifecycle;
    this.update({ busy: true, error: undefined });
    try {
      const world = (await this.request({
        kind: "read-checkpoint",
        id,
      })) as World | null;
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
        const lobby = (await this.request({
          kind: "create",
          rules: manifest.multiplayerCompatibilityId,
        })) as LobbyState;
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
      lobby: (await this.request({
        kind: "member",
        key: "slot",
        value: slotClaim(campaign.id, seatId),
      })) as LobbyState,
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
  async start(choice: { spec: MatchSpec } | { saved: true; id?: string }) {
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
        "saved" in choice
          ? ((await this.request({
              kind: "read-checkpoint",
              ...(choice.id && { id: choice.id }),
            })) as World | null)
          : null;
      if ("saved" in choice && !world)
        throw new Error("No multiplayer save on this computer yet");
      const { members } = this.state.lobby;
      const campaign = this.state.pendingCampaign;
      if (
        world &&
        (!campaign || !("saved" in choice) || campaign.id !== choice.id)
      )
        throw new Error("Choose the multiplayer save again");
      // A resumed match hands each saved company to whoever claimed it; retired ones may stay away.
      const seats = world
        ? resumeSeats(campaign!, members)
        : members.map(({ id, name }) => ({ id, name }));
      const rosterError = world
        ? this.resumeBlocker()
        : this.rosterError(seats, seats);
      if (rosterError) throw new Error(rosterError);
      await this.request({ kind: "lock", ids: seats.map((s) => s.id) });
      locked = true;
      if (!current()) {
        await this.request({ kind: "unlock" }).catch(() => undefined);
        return;
      }
      // A previous start can fail inside the worker; never leave that thread running.
      this.worker?.terminate();
      const worker = await this.workerFactory();
      if (!current()) {
        worker.terminate();
        return;
      }
      this.worker = worker;
      this.connected = new Set(this.state.lobby.connected);
      this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (!current() || this.worker !== worker) return;
        if (data.kind === "error") {
          if (!receivedView) rollback(data.message);
          else this.update({ error: data.message, busy: false });
          return;
        }
        if (data.kind === "checkpoint") {
          this.saving = this.saving
            .catch(() => {})
            .then(() =>
              this.request({ kind: "checkpoint", world: data.world }),
            );
          void this.saving.catch((error) =>
            this.update({ error: `Multiplayer save failed: ${error.message}` }),
          );
          if (data.requestId) {
            const request = this.saveRequests.get(data.requestId);
            this.saveRequests.delete(data.requestId);
            void this.saving.then(
              () => request?.resolve(),
              (error) => request?.reject(error),
            );
          }
          return;
        }
        if (data.kind === "keepalive") {
          for (const id of this.state.lobby.connected)
            if (id !== this.state.lobby.selfId)
              void this.request({ kind: "send", to: id, payload: data }).catch(
                () => this.post({ kind: "disconnect", sender: id }),
              );
          return;
        }
        for (const [id, view] of Object.entries(data.views)) {
          view.disconnected = view.grids
            .filter(
              (g) =>
                !g.retired &&
                g.seat.id !== this.state.lobby.selfId &&
                !this.state.lobby.connected.includes(g.seat.id),
            )
            .map((g) => g.seat.id);
          if (id === this.state.lobby.selfId) {
            receivedView = true;
            this.acceptView(view);
          } else if (this.state.lobby.connected.includes(id))
            void this.request({
              kind: "send",
              to: id,
              payload: { kind: "view", view },
            }).catch(() => this.post({ kind: "disconnect", sender: id }));
        }
      };
      this.worker.onerror = () => {
        if (!current() || this.worker !== worker) return;
        const error =
          "The simulation worker stopped. Resume the multiplayer save to continue.";
        if (!receivedView) rollback(error);
        else this.update({ busy: false, error });
      };
      const epoch = crypto.randomUUID();
      this.post(
        world
          ? { kind: "restore", world, epoch, seats }
          : {
              kind: "create",
              spec: (choice as { spec: MatchSpec }).spec,
              seats,
              matchId: crypto.randomUUID(),
              epoch,
            },
      );
    } catch (error) {
      rollback(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  async save(pause = false) {
    if (!this.worker) {
      if (!this.state.view) return;
      const requestId = crypto.randomUUID();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          this.saveRequests.set(requestId, { resolve, reject });
          timer = setTimeout(
            () => reject(new Error("The host could not finish the save")),
            SAVE_TIMEOUT_MS,
          );
          void this.request({
            kind: "send",
            to: this.state.lobby.hostId!,
            payload: { kind: "save-request", requestId },
          }).catch(reject);
        });
      } finally {
        clearTimeout(timer);
        this.saveRequests.delete(requestId);
      }
      return;
    }
    if (pause) this.closing = true;
    const requestId = crypto.randomUUID();
    let timeout: ReturnType<typeof setTimeout>;
    try {
      await new Promise<void>((resolve, reject) => {
        this.saveRequests.set(requestId, { resolve, reject });
        timeout = setTimeout(
          () => reject(new Error("The host could not finish the save")),
          SAVE_TIMEOUT_MS,
        );
        this.post({ kind: "checkpoint", requestId, pause });
      });
    } catch (error) {
      if (pause) this.closing = false;
      throw error;
    } finally {
      clearTimeout(timeout!);
      this.saveRequests.delete(requestId);
    }
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
      if (!skipSave) await this.save(!!this.worker);
    } catch (error) {
      // The player stays in the match to retry or to leave without saving.
      this.closing = false;
      throw error;
    }
    this.startGeneration++;
    this.worker?.terminate();
    this.worker = undefined;
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
      clearTimeout(this.browseTimer);
      this.browseTimer = undefined;
      this.browseSession = undefined;
      this.publishedSelection = undefined;
      this.browsePeers = new Set();
      ++this.libraryRequest;
      this.update({
        browse: undefined,
        pendingCampaign: undefined,
        library: undefined,
        loadingSaves: false,
        lobby: {
          ...this.state.lobby,
          lobbyId: undefined,
          hostId: undefined,
          members: [],
          connected: [],
        },
        view: undefined,
        pending: false,
        busy: false,
        waitingForHost: false,
      });
      this.closing = false;
    }
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
  publishBrowse(selection: Omit<BrowseState, "session" | "revision">) {
    if (!this.isHost()) return;
    const body = JSON.stringify(selection);
    if (body === this.publishedSelection) return;
    this.publishedSelection = body;
    this.browseSession ??= crypto.randomUUID();
    this.update({
      pendingCampaign: undefined,
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
    for (const id of to ?? lobby.connected)
      if (id !== lobby.selfId)
        void this.request({
          kind: "send",
          to: id,
          payload: { kind: "browse", browse },
        }).catch(() => {});
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
    this.update({ browse, pendingCampaign: undefined });
  }
  /** Marks Ready for exactly this selection; any later change by the host clears it. */
  async setReady(key: string) {
    this.update({
      lobby: (await this.request({
        kind: "member",
        key: "ready",
        value: key,
      })) as LobbyState,
    });
  }
  /** The host closes a finished match and reopens the lobby to choose the next game. */
  async backToLobby() {
    if (!this.isHost()) return;
    this.closing = true;
    try {
      // Keep the finished match's final state as the multiplayer save; a failed write isn't fatal.
      if (this.worker) await this.save(true).catch(() => undefined);
      this.endLocalMatch();
      await this.request({ kind: "unlock" }).catch(() => undefined);
    } finally {
      this.closing = false;
    }
  }
  private endLocalMatch() {
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
      pending: false,
      busy: false,
      waitingForHost: false,
    });
  }
  dispose() {
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
