import type { AppStore, RootState } from "../Store";
import type { GameType } from "../Types";
import type { RoomView } from "../multiplayer/Types";

type ObservableStore = Pick<AppStore, "getState" | "subscribe">;
interface Projection {
  token: number;
  game?: GameType;
  baseline: boolean;
  matchId?: string;
  epoch?: string;
  revision: number;
}
let nextToken = 0;
let projection: Projection | undefined;
let version = 0;
const listeners = new Set<() => void>();
const notify = () => {
  version++;
  [...listeners].forEach((listener) => listener());
};

export const couchPlatformActive = () => !!projection;
export function subscribeCouchPlatform(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Only the owning shell's authoritative P1 view can drive account services. This is a
 * read-only projection: guest grids never enter account observers or the solo save store. */
export function beginCouchPlatform() {
  const token = ++nextToken;
  projection = { token, baseline: true, revision: -1 };
  notify();
  return {
    /** Accept monotone P1 snapshots only while this shell still owns the projection token.
     * A new epoch first exposes an inactive baseline so old achievements are not re-announced. */
    publish(view: RoomView): boolean {
      const current = projection;
      if (
        current?.token !== token ||
        view.game?.multiplayer?.seat !== "local-p1"
      )
        return false;
      const same =
        current.matchId === view.matchId && current.epoch === view.epoch;
      if (same && view.revision < current.revision) return false;
      const first = !same || !current.game;
      projection = {
        token,
        game: view.game,
        baseline: first,
        matchId: view.matchId,
        epoch: view.epoch,
        revision: view.revision,
      };
      // Existing achievement/timeline observers recognize an inactive baseline as restored
      // history. Publish it before live state so a resumed checkpoint cannot announce old awards.
      if (first) notify();
      projection = { ...projection, baseline: false };
      notify();
      return true;
    },
    dispose() {
      if (projection?.token !== token) return;
      projection = undefined;
      notify();
    },
  };
}

/** Existing observers keep one subscription and use shell preferences/account ownership.
 * Input, save leases and the visible shell continue to read their ordinary Redux store. */
export function withCouchPlatform(store: ObservableStore): ObservableStore {
  let cachedBase: RootState | undefined;
  let cachedVersion = -1;
  let cached: RootState;
  return {
    getState() {
      const base = store.getState();
      if (!projection) return base;
      if (base === cachedBase && version === cachedVersion) return cached;
      cachedBase = base;
      cachedVersion = version;
      const game = projection.game ?? base.game;
      cached = {
        ...base,
        game: projection.baseline
          ? {
              ...game,
              inGame: false,
              desktopAchievements: projection.game?.desktopAchievements,
            }
          : game,
        card: {
          ...base.card,
          name: projection.game ? "FACILITIES" : "MAIN_MENU",
        },
        ui: { ...base.ui, victory: null, evidenceRunId: -projection.token },
        saves: {
          ...base.saves,
          activeId: `couch-${projection.token}`,
          transitioning: false,
        },
      };
      return cached;
    },
    subscribe(listener: () => void) {
      const stopStore = store.subscribe(listener);
      const stopProjection = subscribeCouchPlatform(listener);
      return () => {
        stopStore();
        stopProjection();
      };
    },
  };
}
