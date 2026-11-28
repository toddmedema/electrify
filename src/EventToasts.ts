import type { AppStore } from "./Store";
import type {
  GameEventImportanceType,
  GameEventType,
  GameType,
  MapFocusTarget,
} from "./Types";
import { storyOutputMultiplier } from "./helpers/Story";
import { navigate } from "./reducers/Card";
import { setMapFocus, snackbarClose, snackbarOpen } from "./reducers/UI";

export interface EventToastType {
  message: string;
  paused: boolean;
  mapFocus?: MapFocusTarget;
}

const IMPORTANCE_RANK: Record<GameEventImportanceType | "NONE", number> = {
  CRITICAL: 0,
  NOTABLE: 1,
  ROUTINE: 2,
  NONE: 3,
};

function rank(event: GameEventType): number {
  return IMPORTANCE_RANK[event.importance || "NONE"];
}

const WEATHER_ARCS = new Set([
  "delhi-summer",
  "heatwave-drought",
  "hurricane-2008",
  "kariba-drought",
  "texas-deep-freeze",
  "wildfire-intertie",
]);

/** Reuse the simulation's resolved strikes, derates and fire origin. */
function weatherMapFocus(
  event: GameEventType,
  previousMinute: number,
  game: GameType,
): MapFocusTarget | undefined {
  if (event.kind !== "WORLD_EVENT") return undefined;
  const key = event.storyPhaseKey;
  if (!key) {
    if (event.concept !== "severeWeather") return undefined;
    const origin = game.territoryWeather?.fires.findLast(
      ({ startsMinute }) =>
        startsMinute > previousMinute && startsMinute <= game.date.minute,
    )?.tiles[0];
    return origin ? { tileId: origin.tileId } : {};
  }

  const occurrences = game.worldEvents.occurrences.filter(
    (occurrence) =>
      occurrence.key === key || occurrence.attributes.eventKey === key,
  );
  const weather =
    event.concept === "severeWeather" ||
    event.concept === "weather" ||
    occurrences.some(({ attributes, definitionId, effects }) => {
      const [arc, phase] = definitionId.split(":");
      return (
        attributes.hazard !== undefined ||
        effects.temperatureOffsetC !== undefined ||
        effects.hydroRunoffMultiplier !== undefined ||
        WEATHER_ARCS.has(arc) ||
        (arc === "shale-boom" && phase?.startsWith("freeze")) ||
        (!!game.campaign && arc === "bootleg-fire")
      );
    });
  if (!weather) return undefined;

  const facilityIds = game.facilities
    .filter((facility) =>
      occurrences.some(
        ({ startsMinute, effects }) =>
          (facility.minuteCreated ?? 0) <= startsMinute &&
          storyOutputMultiplier(facility, effects, startsMinute) !== 1,
      ),
    )
    .map(({ id }) => id);
  return facilityIds.length ? { facilityIds } : {};
}

// A stopped clock with nothing on screen to say why reads as the game freezing
const PAUSED_TOAST_MS = 8000;
const NEWS_TOAST_MS = 6000;

/**
 * The toast, if any, for what the clock just did between two game states.
 *
 * Only news the simulation raised counts: a build, sale or choice is the player's own action and
 * already answered where they took it, and loading a run brings its history, not news. Routine
 * entries stay in the Events pane; blackouts and finished construction already raise their own.
 * When an event stopped the clock, the toast names it whatever its importance, so a pause is
 * never unexplained.
 */
export function eventToastForUpdate(
  previous: GameType,
  current: GameType,
): EventToastType | undefined {
  if (
    previous.eventLog === current.eventLog ||
    !previous.inGame ||
    !current.inGame ||
    current.date.minute <= previous.date.minute
  ) {
    return undefined;
  }
  const lastSeen = previous.eventLog[0]?.id ?? 0;
  const fresh = current.eventLog.filter((event) => event.id > lastSeen);
  const paused = previous.speed !== "PAUSED" && current.speed === "PAUSED";
  const ranked = fresh.filter((event) => event.importance);
  const candidates = paused
    ? ranked.length > 0
      ? ranked
      : fresh
    : ranked.filter((event) => event.importance !== "ROUTINE");
  if (candidates.length === 0) {
    return undefined;
  }
  // Newest first, so a stable sort keeps the most recent of the most important on top
  const lead = [...candidates].sort((a, b) => rank(a) - rank(b))[0];
  const more = candidates.length - 1;
  const text = lead.title || lead.message;
  const mapFocus = weatherMapFocus(lead, previous.date.minute, current);
  return {
    message: `${paused ? "Paused: " : ""}${text}${more > 0 ? ` (+${more} more)` : ""}`,
    paused,
    ...(mapFocus && { mapFocus }),
  };
}

export function startEventToasts(store: AppStore): () => void {
  let previous = store.getState().game;
  return store.subscribe(() => {
    const state = store.getState();
    const current = state.game;
    if (current === previous) return;
    const toast = eventToastForUpdate(previous, current);
    previous = current;
    if (!toast) return;
    // News yields the single toast slot to an open one, such as a pause's undo; an explanation
    // for a stopped clock does not
    if (!toast.paused && state.ui.snackbar.open) return;
    store.dispatch(
      snackbarOpen({
        message: toast.message,
        open: true,
        timeout: toast.paused ? PAUSED_TOAST_MS : NEWS_TOAST_MS,
        actionLabel: "View",
        action: () => {
          store.dispatch(snackbarClose());
          if (!toast.mapFocus) {
            store.dispatch(navigate("EVENTS"));
            return;
          }
          store.dispatch(navigate("FACILITIES"));
          store.dispatch(setMapFocus(toast.mapFocus));
        },
      }),
    );
  });
}
