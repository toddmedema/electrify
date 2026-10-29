import type { AppStore, RootState } from "./Store";
import type {
  DesktopActivity,
  DesktopBridge,
  DesktopTimelineEvent,
} from "./Desktop";
import { SCENARIOS } from "./data/Scenarios";
import type { GameEventType } from "./Types";

type ActivityStore = Pick<AppStore, "getState" | "subscribe">;
let observerSequence = 0;

/** Publish only authored IDs and bounded progress; custom names never leave the renderer. */
export function desktopActivity(state: RootState): DesktopActivity {
  const { game, ui, card, saves } = state;
  const timelineEnabled = !!state.settings.steamTimelineEnabled;
  if (card.name === "LOADING" || saves.transitioning)
    return { phase: "loading", timelineEnabled };
  const phase = ui.victory
    ? ui.victory.outcome === "completed"
      ? "victory"
      : "ended"
    : !game.inGame || card.name === "MAIN_MENU"
      ? "menu"
      : game.speed === "PAUSED" ||
          ["SETTINGS", "MANUAL", "MODS"].includes(card.name)
        ? "paused"
        : "playing";
  if (phase === "menu") return { phase, timelineEnabled };
  const scenarioId = ui.victory?.scenarioId ?? game.scenarioId;
  const scenario = SCENARIOS.find(({ id }) => id === scenarioId);
  const durationMonths =
    scenario?.durationMonths ?? game.customScenario?.durationMonths ?? 12;
  const totalYears = Math.min(
    10000,
    Math.max(
      1,
      Number.isFinite(durationMonths) ? Math.ceil(durationMonths / 12) : 1,
    ),
  );
  const year = Math.min(
    totalYears,
    Math.max(
      1,
      Number.isFinite(game.date.monthsElapsed)
        ? Math.floor(game.date.monthsElapsed / 12) + 1
        : 1,
    ),
  );
  return { phase, scenarioId, year, totalYears, timelineEnabled };
}

const highlightKind: Partial<
  Record<GameEventType["kind"], DesktopTimelineEvent["kind"]>
> = {
  CONSTRUCTION: "construction",
  BLACKOUT: "blackout",
  BLACKOUT_OVER: "recovery",
};

/** Observe committed events, never forecast data or saved history. */
export function startDesktopActivity(
  store: ActivityStore,
  desktop: DesktopBridge,
): () => void {
  let previous = store.getState();
  let presence: string | undefined;
  let session = 0;
  // Presentation-only identity distinguishes resumed play segments and renderer reloads.
  const observer = `${Date.now()}-${++observerSequence}`;
  const runKey = (state: RootState) =>
    `${state.saves.activeId || "session"}:${observer}:${session}`;
  let stopped = false;
  let pending = Promise.resolve();
  const highWater = new Map<string, number>();
  const victories = new Set<string>();
  const enqueue = (action: () => Promise<void>) => {
    pending = pending
      .then(() => (stopped ? undefined : action()))
      .catch(() => undefined);
  };
  const publish = (state: RootState, force = false) => {
    const activity = desktopActivity(state);
    const key = JSON.stringify(activity);
    if (force || key !== presence) {
      presence = key;
      if (desktop.setActivity)
        enqueue(() =>
          JSON.stringify(desktopActivity(store.getState())) === key
            ? desktop.setActivity!(activity)
            : Promise.resolve(),
        );
    }
    return activity;
  };
  const update = () => {
    const current = store.getState();
    const activity = publish(current);
    const game = current.game;
    const reset =
      current.ui.evidenceRunId !== previous.ui.evidenceRunId ||
      current.saves.activeId !== previous.saves.activeId ||
      game.date.minute < previous.game.date.minute;
    if (reset) session++;
    const runId = runKey(current);
    const latest = Math.max(0, ...game.eventLog.map(({ id }) => id));
    const seen = highWater.get(runId) ?? latest;
    const enabled = !!current.settings.steamTimelineEnabled;
    const baseline =
      reset ||
      !previous.game.inGame ||
      !previous.settings.steamTimelineEnabled ||
      !game.inGame ||
      !!current.saves.transitioning;
    const send = (eventId: string, kind: DesktopTimelineEvent["kind"]) => {
      const event: DesktopTimelineEvent = {
        runId,
        eventId,
        kind,
        scenarioId: game.scenarioId,
        year: activity.year || 1,
      };
      if (desktop.addTimelineEvent)
        enqueue(() => {
          const live = store.getState();
          return live.settings.steamTimelineEnabled &&
            runKey(live) === runId &&
            !live.saves.transitioning &&
            (kind === "victory" || live.game.inGame)
            ? desktop.addTimelineEvent!(event)
            : Promise.resolve();
        });
    };
    if (enabled && !baseline) {
      for (const event of [...game.eventLog].reverse()) {
        const kind = highlightKind[event.kind];
        if (event.id > seen && kind) send(`event-${event.id}`, kind);
      }
    }
    highWater.set(runId, Math.max(seen, latest));
    const victory = current.ui.victory;
    if (victory?.outcome === "completed") {
      if (
        enabled &&
        !reset &&
        previous.settings.steamTimelineEnabled &&
        !current.saves.transitioning &&
        previous.ui.victory !== victory &&
        !victories.has(runId)
      )
        send("victory", "victory");
      victories.add(runId);
    }
    // Bound presentation bookkeeping without touching simulation/save state.
    if (highWater.size > 256) {
      const oldest = highWater.keys().next().value;
      if (oldest !== undefined) {
        highWater.delete(oldest);
        victories.delete(oldest);
      }
    }
    previous = current;
  };
  highWater.set(
    runKey(previous),
    Math.max(0, ...previous.game.eventLog.map(({ id }) => id)),
  );
  if (previous.ui.victory?.outcome === "completed")
    victories.add(runKey(previous));
  publish(previous);
  const unsubscribe = store.subscribe(update);
  let connection: string | undefined;
  const unsubscribeSteam = desktop.onStateChanged(({ steam }) => {
    const next = JSON.stringify([
      steam.available,
      steam.online,
      steam.steamId,
      steam.timelineSupported,
    ]);
    if (next !== connection) {
      connection = next;
      publish(store.getState(), true);
    }
  });
  return () => {
    stopped = true;
    unsubscribe();
    unsubscribeSteam();
  };
}
