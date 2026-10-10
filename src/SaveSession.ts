import type { Middleware } from "@reduxjs/toolkit";
import type { AppStore } from "./Store";
import type {
  DialogType,
  GameType,
  SaveFileType,
  SaveLease,
  SaveRecord,
  SavedRunResult,
  VictoryType,
} from "./Types";
import { getStore } from "./StoreRegistry";
import { refreshToUpdate } from "./helpers/Cache";
import { saveTitle } from "./helpers/SaveDisplay";
import { getScenario } from "./data/Scenarios";
import { parseSave, serializeSave } from "./SaveGame";
import { SaveRepository } from "./SaveRepository";
import {
  acquireSaveWriterLock,
  supportsSaveWriterLocks,
} from "./SaveWriterLock";
import type { SaveWriterLock } from "./SaveWriterLock";
import {
  SaveRepositoryError,
  savedRunResult,
  suggestedSaveName,
  normalizeSaveName,
} from "./SaveModel";
import { downloadSave, downloadSaveRecovery } from "./SaveFile";
import {
  libraryLoading,
  libraryLoaded,
  libraryFailed,
  sessionChanged,
  saveUnavailable,
} from "./SaveLibrary";
import { requestCloudSave, withRunSaveEffects } from "./SaveEffects";
import {
  launchRun,
  loaded,
  quit,
  resume,
  start,
  startReplay,
} from "./reducers/GameActions";
import { navigate } from "./reducers/Card";
import {
  dialogClose,
  dialogOpen,
  manualHelpClose,
  manualHelpOpen,
  victoryClose,
  victoryOpen,
} from "./reducers/UI";

export const SAVE_CHECKPOINT_MS = 15000;
const PAUSED_SAVE_DEBOUNCE_MS = 500;
const LEASE_RENEW_MS = 10000;
const RELOAD_BINDING_KEY = "electrify-save-writer";
function newSaveToken(): string {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
function rememberWriter(session: ActiveSaveSession): void {
  try {
    sessionStorage.setItem(
      RELOAD_BINDING_KEY,
      JSON.stringify({ id: session.id, token: session.lease.writerToken }),
    );
  } catch {
    /* Optional reload handoff; persistence still works without sessionStorage. */
  }
}
function forgetWriter(): void {
  try {
    sessionStorage.removeItem(RELOAD_BINDING_KEY);
  } catch {
    /* Optional handoff. */
  }
}
function resumeToken(id: string): string {
  // A copied sessionStorage binding cannot acquire its original live document's token lock.
  if (supportsSaveWriterLocks()) {
    try {
      const stored = JSON.parse(
        sessionStorage.getItem(RELOAD_BINDING_KEY) || "null",
      );
      if (stored?.id === id && typeof stored.token === "string")
        return stored.token;
    } catch {
      /* Start with a fresh token. */
    }
  }
  return newSaveToken();
}

/** A failed open; a save from a newer app offers the update that can open it. */
function saveErrorDialog(
  title: string,
  error: unknown,
  message = getSaveErrorMessage(error),
): DialogType {
  const newer =
    error instanceof SaveRepositoryError && error.code === "incompatible";
  return {
    title,
    message,
    open: true,
    closeText: newer ? "Not now" : "OK",
    ...(newer
      ? { action: refreshToUpdate, actionLabel: "Refresh to update" }
      : {}),
  };
}

export function getSaveErrorMessage(error: unknown): string {
  if (error instanceof SaveRepositoryError) {
    switch (error.code) {
      case "quota":
        return "Browser storage is full. Export this game or delete a save, then retry.";
      case "conflict":
        return "This game is open in another tab or has newer progress. Export your current game, then reopen the latest save.";
      case "missing":
        return "This save no longer exists. Export your current game to keep this progress.";
      case "invalid":
        return "This save cannot be opened because its contents are invalid.";
      case "incompatible":
        return error.message;
      default:
        return "Browser storage is unavailable. Enable storage for this site, or export your current game.";
    }
  }
  return error instanceof Error
    ? error.message
    : "Could not save this game. Retry or export it to keep your progress.";
}

/** One explicitly bound writer; queued snapshots can never select a newer run as their target. */
export class ActiveSaveSession {
  public lease: SaveLease;
  public created: boolean;
  public latest: GameType;
  public saved?: GameType;
  public result?: SavedRunResult;
  public failure?: unknown;
  public suspended = false;
  public terminal = false;
  private pending?: GameType;
  private running?: Promise<void>;
  private outcomePending = false;
  private writerLock?: SaveWriterLock;

  constructor(
    public readonly repository: SaveRepository,
    public readonly id: string,
    public name: string,
    public readonly generation: number,
    game: GameType,
    private readonly notify: (
      state: "saving" | "saved" | "failed",
      savedAt?: string,
      error?: string,
    ) => void,
    record?: SaveRecord,
    writerToken = newSaveToken(),
    writerLock?: SaveWriterLock,
  ) {
    this.latest = game;
    this.created = !!record;
    this.lease = {
      saveId: id,
      writerToken,
      revision: record?.metadata.revision || 0,
    };
    this.result = record?.result;
    this.saved = record ? game : undefined;
    this.writerLock = writerLock;
  }

  public get mutationLease(): SaveLease | undefined {
    return this.terminal && !this.outcomePending ? undefined : this.lease;
  }

  public capture(game: GameType): void {
    if (!this.suspended && !this.terminal) {
      this.latest = game;
      if (this.running) this.pending = game;
    }
  }

  public outcome(game: GameType, result: SavedRunResult): void {
    this.latest = game;
    this.result = result;
    this.outcomePending = true;
    this.terminal = result.outcome !== "completed";
    this.pending = game;
    void this.flush().catch(() => undefined);
  }

  public async flush(): Promise<void> {
    if (this.suspended) return;
    if (this.latest !== this.saved || this.outcomePending)
      this.pending = this.latest;
    if (this.running) {
      await this.running;
      if (this.pending) return this.flush();
      return;
    }
    if (!this.pending) return;
    this.running = this.drain();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }

  private async drain(): Promise<void> {
    while (this.pending && !this.suspended) {
      const game = this.pending;
      this.pending = undefined;
      if (game === this.saved && !this.outcomePending) continue;
      const result = this.result;
      const outcome = this.outcomePending;
      this.notify("saving");
      try {
        if (!this.writerLock && supportsSaveWriterLocks()) {
          this.writerLock = await acquireSaveWriterLock(this.lease.writerToken);
        }
        const save = serializeSave(game);
        const scenarioName =
          getScenario(game.scenarioId, game.customScenario)?.name || "Game";
        let savedAt: string;
        if (!this.created) {
          const record = await this.repository.create({
            id: this.id,
            name: this.name,
            save,
            scenarioName,
            writerToken: this.lease.writerToken,
            lastPlayedAt: new Date().toISOString(),
            status: result?.outcome || "inProgress",
            result,
          });
          this.created = true;
          this.lease.revision = record.metadata.revision;
          savedAt = record.metadata.savedAt;
        } else {
          await this.repository.renew(this.lease);
          const metadata =
            outcome && result
              ? await this.repository.recordOutcome(
                  this.lease,
                  save,
                  scenarioName,
                  result,
                )
              : await this.repository.writeSnapshot(
                  this.lease,
                  save,
                  scenarioName,
                );
          this.lease.revision = metadata.revision;
          savedAt = metadata.savedAt;
        }
        this.saved = game;
        if (result === this.result) this.outcomePending = false;
        this.failure = undefined;
        this.notify("saved", savedAt);
        if (this.terminal && !this.outcomePending) await this.release();
      } catch (error) {
        this.pending ||= game;
        this.failure = error;
        this.notify("failed", undefined, getSaveErrorMessage(error));
        throw error;
      }
    }
  }

  public async settle(): Promise<void> {
    await this.running;
  }
  public async release(): Promise<void> {
    if (this.created && this.mutationLease)
      await this.repository.release(this.lease);
    await this.releaseWriterLock();
  }
  public async releaseWriterLock(): Promise<void> {
    await this.writerLock?.release();
    this.writerLock = undefined;
  }
  public file(): SaveFileType {
    return {
      name: this.name,
      status: this.result?.outcome || "inProgress",
      save: serializeSave(this.latest),
      result: this.result,
    };
  }
}

export const saveRepository = new SaveRepository(parseSave);
const repository = saveRepository;
type ReservedSave = Awaited<ReturnType<SaveRepository["prepareResume"]>> & {
  writerLock: SaveWriterLock;
};
async function releaseReservedSave(target: ReservedSave): Promise<void> {
  await repository.release(target.lease).catch(() => undefined);
  await target.writerLock.release();
}
let active: ActiveSaveSession | undefined;
let prepared: (ReservedSave & { generation: number }) | undefined;
let preparing: (ReservedSave & { request: number }) | undefined;
let generation = 0;
let transitionRequest = 0;
let preparationRequest = 0;
let transitionTail: Promise<void> = Promise.resolve();
let transitionsPending = 0;
let replacing = false;
let installed = false;
let pausedTimer: ReturnType<typeof setTimeout> | undefined;
let teardownTimer: ReturnType<typeof setTimeout> | undefined;
let liveReference: GameType | undefined;
let attemptedYear = -1;
let libraryRequest = 0;

export function getLoadingGeneration(): number {
  return generation;
}
export function isCurrentLoadingGeneration(value: number): boolean {
  return value === generation;
}

function notifySession(
  state: "saving" | "saved" | "failed",
  savedAt?: string,
  error?: string,
): void {
  getStore().dispatch(
    sessionChanged({
      saveState: state,
      saveError: error,
      ...(savedAt ? { savedAt } : {}),
    }),
  );
  if (state === "saved") {
    if (active) rememberWriter(active);
    void refreshSavedGames();
  }
}
function boundNotifier(id: string, request: number): typeof notifySession {
  return (...args) => {
    if (active?.id === id && active.generation === request)
      notifySession(...args);
  };
}
function showActive(): void {
  getStore().dispatch(
    sessionChanged({
      activeId: active?.id,
      pendingName: active?.name,
      saveState: active ? (active.created ? "saved" : "saving") : "idle",
      saveError: undefined,
      savedAt: undefined,
    }),
  );
}

export async function refreshSavedGames(): Promise<void> {
  const request = ++libraryRequest;
  try {
    const entries = await repository.list();
    if (request === libraryRequest) getStore().dispatch(libraryLoaded(entries));
  } catch (error) {
    if (request === libraryRequest)
      getStore().dispatch(libraryFailed(getSaveErrorMessage(error)));
  }
}
export async function readSavedGame(id: string): Promise<SaveRecord> {
  const revision = getStore()
    .getState()
    .saves.entries.find((save) => save.id === id)?.revision;
  try {
    return await repository.read(id);
  } catch (error) {
    noteUnavailable(id, error, revision);
    throw error;
  }
}
function noteUnavailable(id: string, error: unknown, revision?: number): void {
  const entry = getStore()
    .getState()
    .saves.entries.find((save) => save.id === id);
  if (
    entry &&
    entry.revision === revision &&
    error instanceof SaveRepositoryError &&
    (error.code === "invalid" || error.code === "missing")
  ) {
    getStore().dispatch(
      saveUnavailable({
        id,
        revision: entry.revision,
        message: "Save unavailable. Download its recovery data or delete it.",
      }),
    );
  }
}
export async function exportSaveRecovery(id: string): Promise<void> {
  downloadSaveRecovery(id, await repository.readRaw(id));
}
export async function importSavedGame(file: SaveFileType): Promise<string> {
  const scenario = getScenario(
    file.save.game.scenarioId,
    file.save.game.customScenario,
  );
  if (!scenario || scenario.tutorialSteps || file.save.game.replayPlayback)
    throw new Error("Only playable games can be imported.");
  const record = await repository.create({
    ...file,
    scenarioName: scenario.name,
  });
  await refreshSavedGames();
  requestCloudSave(record.metadata.id);
  return record.metadata.id;
}
export async function exportSavedGame(id: string): Promise<void> {
  if (active?.id === id) return exportCurrentSave();
  const record = await readSavedGame(id);
  requestCloudSave(id);
  downloadSave({
    name: record.metadata.name,
    status: record.metadata.status,
    save: record.save,
    result: record.result,
  });
}
export async function snapshotSavedGame(id: string): Promise<SaveFileType> {
  const requested = active;
  if (requested?.id === id) {
    requested.capture(getStore().getState().game);
    // Sharing also offers a way to keep progress when local storage is full.
    try {
      await requested.flush();
    } catch {
      /* The captured snapshot is still valid. */
    }
    requestCloudSave(id);
    return requested.file();
  }
  const record = await readSavedGame(id);
  requestCloudSave(id);
  return {
    name: record.metadata.name,
    status: record.metadata.status,
    save: record.save,
    result: record.result,
  };
}
export async function exportCurrentSave(): Promise<void> {
  const requested = active;
  if (!requested) return;
  requested.capture(getStore().getState().game);
  try {
    await requested.flush();
  } catch {
    /* The direct snapshot remains exportable when storage fails. */
  }
  downloadSave(requested.file());
  requestCloudSave(requested.id);
}
export async function retryCurrentSave(): Promise<boolean> {
  if (!active) return false;
  active.capture(getStore().getState().game);
  try {
    await active.flush();
    requestCloudSave(active.id);
    return true;
  } catch {
    return false;
  }
}
export async function renameSavedGame(id: string, name: string): Promise<void> {
  const current = active?.id === id ? active : undefined;
  if (current) {
    current.suspended = true;
    try {
      await current.settle();
    } catch {
      /* Metadata can still be renamed after a snapshot failure. */
    }
  }
  try {
    if (current && !current.created) {
      current.name = normalizeSaveName(name);
      getStore().dispatch(sessionChanged({ pendingName: current.name }));
      return;
    }
    const metadata = await repository.rename(id, name, current?.mutationLease);
    if (current) {
      current.name = metadata.name;
      current.lease.revision = metadata.revision;
      getStore().dispatch(sessionChanged({ pendingName: metadata.name }));
    }
    await refreshSavedGames();
    requestCloudSave(id);
  } finally {
    if (current) {
      current.suspended = false;
      current.capture(getStore().getState().game);
    }
  }
}

async function abandonActive(): Promise<void> {
  const outgoing = active;
  if (!outgoing) return;
  outgoing.suspended = true;
  try {
    await outgoing.settle();
  } catch {
    /* Keep the deliberate abandonment separate from save success. */
  }
  try {
    await outgoing.release();
  } catch {
    /* Lease expiry also fences abandoned writes. */
  }
  await outgoing.releaseWriterLock();
  if (active === outgoing) {
    active = undefined;
    showActive();
  }
}

function saveFailureDialog(
  proceed: () => void,
  retry = () => {
    void runSaveTransition(proceed);
  },
): void {
  const dispatch = getStore().dispatch;
  replacing = true;
  try {
    dispatch(
      dialogOpen({
        title: "Your game could not be saved",
        message: getSaveErrorMessage(active?.failure),
        open: true,
        closeText: "Cancel",
        focusCancel: true,
        actionLabel: "Retry",
        action: () => {
          dispatch(dialogClose());
          retry();
        },
        secondaryLabel: "Export current game",
        secondaryAction: () => {
          void exportCurrentSave();
        },
        tertiaryLabel: "Leave without saving",
        tertiaryAction: () => {
          dispatch(
            dialogOpen({
              title: "Leave without saving?",
              message: active?.created
                ? "Changes since the last successful save will be lost. Your existing save will remain."
                : "This game has never been saved. The entire current run will be lost unless you exported it.",
              open: true,
              closeText: "Cancel",
              destructive: true,
              actionLabel: "Leave without saving",
              action: () => {
                dispatch(dialogClose());
                void abandonActive().then(retry);
              },
            }),
          );
        },
      }),
    );
  } finally {
    replacing = false;
  }
}

/** Await the final source snapshot before any bundle replaces the live Redux game. */
export async function runSaveTransition(
  proceed: () => void,
  retry?: () => void,
): Promise<boolean> {
  const request = ++transitionRequest;
  preparationRequest++;
  const previous = transitionTail;
  let finish!: () => void;
  transitionTail = new Promise<void>((resolve) => {
    finish = resolve;
  });
  transitionsPending++;
  getStore().dispatch(sessionChanged({ transitioning: true }));
  try {
    // Serialize handoffs, including lease release. A newer accepted intent can
    // supersede this one, but cannot replace Redux while its writer is settling.
    await previous;
    if (request !== transitionRequest) return false;
    const outgoing = active;
    if (outgoing) {
      replacing = true;
      try {
        getStore().dispatch({
          type: "game/delta",
          payload: { speed: "PAUSED" },
        });
      } finally {
        replacing = false;
      }
      outgoing.capture(getStore().getState().game);
      try {
        await outgoing.flush();
      } catch {
        if (request === transitionRequest) saveFailureDialog(proceed, retry);
        return false;
      }
      if (request !== transitionRequest) return false;
      outgoing.suspended = true;
      try {
        await outgoing.release();
      } catch (error) {
        outgoing.suspended = false;
        outgoing.failure = error;
        notifySession("failed", undefined, getSaveErrorMessage(error));
        if (request === transitionRequest) saveFailureDialog(proceed, retry);
        return false;
      }
      if (active === outgoing) {
        active = undefined;
        forgetWriter();
        showActive();
      }
    }
    if (request !== transitionRequest) return false;
    if (prepared) {
      const target = prepared;
      prepared = undefined;
      generation++;
      await releaseReservedSave(target);
      if (request !== transitionRequest) return false;
    }
    replacing = true;
    try {
      proceed();
      return true;
    } finally {
      replacing = false;
    }
  } finally {
    finish();
    transitionsPending--;
    if (!transitionsPending)
      getStore().dispatch(sessionChanged({ transitioning: false }));
  }
}

export async function quitSavedGame(options?: {
  toScenarioList?: boolean;
}): Promise<boolean> {
  const outgoing = active;
  return runSaveTransition(() => {
    getStore().dispatch(quit(options));
    if (outgoing?.created && !outgoing.failure) {
      requestCloudSave(outgoing.id);
      getStore().dispatch(sessionChanged({ cloudPromptRequested: true }));
    }
  });
}

export async function resumeSavedGame(id: string): Promise<boolean> {
  if (active?.id === id) {
    getStore().dispatch(navigate("FACILITIES"));
    return true;
  }
  const request = ++preparationRequest;
  const previousTransition = transitionRequest;
  let currentRequest: number | undefined;
  let candidate: ReservedSave | undefined;
  const revision = getStore()
    .getState()
    .saves.entries.find((save) => save.id === id)?.revision;
  let writerLock: SaveWriterLock | undefined;
  try {
    const writerToken = resumeToken(id);
    writerLock = await acquireSaveWriterLock(writerToken);
    candidate = {
      ...(await repository.prepareResume(id, writerToken)),
      writerLock,
    };
    const scenario = getScenario(
      candidate.record.save.game.scenarioId,
      candidate.record.save.game.customScenario,
    );
    if (!scenario || scenario.tutorialSteps)
      throw new SaveRepositoryError(
        "invalid",
        "This save’s mission is unavailable.",
      );
    if (
      request !== preparationRequest ||
      previousTransition !== transitionRequest
    ) {
      await releaseReservedSave(candidate);
      return false;
    }
    preparing = { ...candidate, request };
    const target = candidate;
    const proceed = () => {
      getStore().dispatch(resume(target.record.save.game));
      prepared = { ...target, generation };
    };
    // Reserve the target first; failed source persistence must leave the source intact.
    currentRequest = transitionRequest + 1;
    const outcome = await runSaveTransition(proceed, () => {
      void resumeSavedGame(id);
    });
    if (!outcome) await releaseReservedSave(target);
    return outcome;
  } catch (error) {
    if (candidate) await releaseReservedSave(candidate);
    else await writerLock?.release();
    if (
      currentRequest !== undefined
        ? currentRequest === transitionRequest
        : request === preparationRequest &&
          previousTransition === transitionRequest
    ) {
      noteUnavailable(id, error, revision);
      getStore().dispatch(navigate("SAVED_GAMES"));
      getStore().dispatch(
        dialogOpen(saveErrorDialog("Could not open this save", error)),
      );
    }
    return false;
  } finally {
    if (preparing?.request === request) preparing = undefined;
  }
}

/** Loading renews/resolves the same candidate before it is allowed to mark live state opened. */
export async function completeSaveLoading(request: number): Promise<boolean> {
  if (request !== generation) return false;
  const target = prepared;
  if (target && target.generation === request) {
    try {
      target.lease = await repository.markOpened(target.lease);
      if (request !== generation || prepared !== target) {
        await releaseReservedSave(target);
        return false;
      }
      active = new ActiveSaveSession(
        repository,
        target.record.metadata.id,
        target.record.metadata.name,
        request,
        getStore().getState().game,
        boundNotifier(target.record.metadata.id, request),
        target.record,
        target.lease.writerToken,
        target.writerLock,
      );
      active.lease = target.lease;
      prepared = undefined;
      rememberWriter(active);
      showActive();
    } catch (error) {
      await failSaveLoading(request, error);
      throw error;
    }
  }
  return request === generation;
}
export async function failSaveLoading(
  request: number,
  error?: unknown,
): Promise<void> {
  if (prepared?.generation === request) {
    const target = prepared;
    prepared = undefined;
    await releaseReservedSave(target);
    if (request === generation) {
      // Drop the abandoned target slice and its previous gameplay history together.
      // Back must never reveal a half-loaded game without a writer or the correct caches.
      replacing = true;
      try {
        getStore().dispatch(quit());
        getStore().dispatch(navigate("SAVED_GAMES"));
      } finally {
        replacing = false;
      }
      getStore().dispatch(
        dialogOpen(
          saveErrorDialog(
            "Could not prepare this game",
            error,
            error
              ? getSaveErrorMessage(error)
              : "The save remains in your library. Try opening it again.",
          ),
        ),
      );
    }
  }
}

export async function deleteSavedGame(id: string): Promise<void> {
  const current = active?.id === id ? active : undefined;
  if (current) {
    current.suspended = true;
    try {
      await current.settle();
    } catch {
      /* Delete also covers an unsaved pending run. */
    }
    try {
      if (current.created) await repository.delete(id, current.mutationLease);
    } catch (error) {
      current.suspended = false;
      current.capture(getStore().getState().game);
      throw error;
    }
    await current.releaseWriterLock();
    active = undefined;
    forgetWriter();
    showActive();
    replacing = true;
    try {
      getStore().dispatch(quit());
      getStore().dispatch(navigate("SAVED_GAMES"));
    } finally {
      replacing = false;
    }
  } else await repository.delete(id);
  await refreshSavedGames();
  requestCloudSave(id);
}

function snapshotChanged(): void {
  const game = getStore().getState().game;
  if (
    !active ||
    !game.inGame ||
    game.replayPlayback ||
    active.generation !== generation ||
    active.suspended ||
    active.terminal
  )
    return;
  if (game === liveReference) return;
  liveReference = game;
  active.capture(game);
  if (game.date.year !== attemptedYear) {
    attemptedYear = game.date.year;
    void active.flush().catch(() => undefined);
  } else if (game.speed === "PAUSED") {
    clearTimeout(pausedTimer);
    pausedTimer = setTimeout(() => {
      void active?.flush().catch(() => undefined);
    }, PAUSED_SAVE_DEBOUNCE_MS);
  }
}

function afterLoaded(): void {
  const game = getStore().getState().game;
  const scenario = getScenario(game.scenarioId, game.customScenario);
  if (game.replayPlayback || !scenario || scenario.tutorialSteps) return;
  if (!active) {
    const name = suggestedSaveName(
      scenario.name,
      getStore().getState().saves.entries.map(saveTitle),
    );
    const id = newSaveToken();
    active = new ActiveSaveSession(
      repository,
      id,
      name,
      generation,
      game,
      boundNotifier(id, generation),
    );
    showActive();
  }
  active.capture(game);
  attemptedYear = game.date.year;
  liveReference = game;
  void active.flush().catch(() => undefined);
}

export const saveSessionMiddleware: Middleware = () => (next) => (action) => {
  // The scheduled final paused tick clears the reducer's tick-loop flag. Dropping
  // it would strand Play after a failed handoff, even though no time can advance.
  if (
    transitionsPending &&
    typeof action === "object" &&
    action !== null &&
    "type" in action &&
    action.type === "game/tick"
  ) {
    const game = getStore().getState().game;
    if (!game.inGame || game.speed === "PAUSED") return next(action);
  }
  if (
    transitionsPending &&
    !replacing &&
    (dialogClose.match(action) ||
      dialogOpen.match(action) ||
      manualHelpClose.match(action) ||
      manualHelpOpen.match(action) ||
      victoryClose.match(action) ||
      victoryOpen.match(action))
  )
    return action;
  if (
    transitionsPending &&
    !replacing &&
    typeof action === "object" &&
    action !== null &&
    "type" in action &&
    typeof action.type === "string" &&
    (action.type.startsWith("game/") || action.type.startsWith("card/"))
  )
    return action;
  if (quit.match(action) && active && !replacing) {
    void quitSavedGame(action.payload);
    return action;
  }
  const replaces =
    start.match(action) ||
    launchRun.match(action) ||
    resume.match(action) ||
    startReplay.match(action) ||
    quit.match(action);
  if (replaces) {
    generation++;
    liveReference = undefined;
    attemptedYear = -1;
  }
  const bound = active;
  const outcomes: Array<{ victory: VictoryType; message?: () => string }> = [];
  const result = withRunSaveEffects(
    bound
      ? { outcome: (victory, message) => outcomes.push({ victory, message }) }
      : undefined,
    () => next(action),
  );
  if (installed && loaded.match(action)) afterLoaded();
  if (bound && outcomes.length) {
    const game = getStore().getState().game;
    for (const outcome of outcomes)
      bound.outcome(
        game,
        savedRunResult({
          ...outcome.victory,
          endMessage: outcome.message?.() || outcome.victory.endMessage,
        }),
      );
  }
  return result;
};

function renewOwnedLease(
  lease: SaveLease,
  currentSession?: ActiveSaveSession,
): void {
  void repository.renew(lease).catch((error) => {
    if (
      currentSession &&
      active === currentSession &&
      currentSession.lease === lease
    ) {
      currentSession.failure = error;
      notifySession("failed", undefined, getSaveErrorMessage(error));
    }
  });
}

export function startSaveSessions(store: AppStore): () => void {
  clearTimeout(teardownTimer);
  installed = true;
  store.dispatch(libraryLoading());
  void repository
    .initialize()
    .then(refreshSavedGames)
    .catch((error) =>
      store.dispatch(libraryFailed(getSaveErrorMessage(error))),
    );
  const unsubscribe = store.subscribe(snapshotChanged);
  const checkpoint = setInterval(() => {
    if (active && !active.terminal) void active.flush().catch(() => undefined);
  }, SAVE_CHECKPOINT_MS);
  const renewal = setInterval(() => {
    const currentSession = active;
    const leases = [
      preparing?.lease,
      prepared?.lease,
      currentSession?.created &&
      (!currentSession.terminal || currentSession.failure)
        ? currentSession.lease
        : undefined,
    ].filter((lease): lease is SaveLease => !!lease);
    for (const lease of leases) renewOwnedLease(lease, currentSession);
  }, LEASE_RENEW_MS);
  const flush = () => {
    if (active) void active.flush().catch(() => undefined);
  };
  const visible = () => {
    if (document.visibilityState === "hidden") flush();
    else void refreshSavedGames();
  };
  const focused = () => void refreshSavedGames();
  window.addEventListener("pagehide", flush);
  window.addEventListener("focus", focused);
  document.addEventListener("visibilitychange", visible);
  const unsubscribeRepository = repository.subscribe(focused);
  return () => {
    unsubscribe();
    clearInterval(checkpoint);
    clearInterval(renewal);
    clearTimeout(pausedTimer);
    window.removeEventListener("pagehide", flush);
    window.removeEventListener("focus", focused);
    document.removeEventListener("visibilitychange", visible);
    unsubscribeRepository();
    teardownTimer = setTimeout(() => {
      installed = false;
      generation++;
      transitionRequest++;
      preparationRequest++;
      const outgoing = active;
      if (outgoing) {
        outgoing.suspended = true;
        void outgoing
          .settle()
          .catch(() => undefined)
          .then(() => outgoing.release())
          .catch(() => undefined)
          .finally(() => outgoing.releaseWriterLock())
          .catch(() => undefined);
      }
      active = undefined;
      if (prepared) void releaseReservedSave(prepared).catch(() => undefined);
      if (preparing) void releaseReservedSave(preparing).catch(() => undefined);
      prepared = undefined;
      preparing = undefined;
      showActive();
    }, 0);
  };
}
