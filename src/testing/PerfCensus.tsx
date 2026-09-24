// Development-only React commit, DOM mutation and dispatch census (benchmark B3/B4 in
// docs/perf-plan.md). src/index.tsx loads this module only outside production builds, so none of
// it ships. e2e/perf-census.spec.ts reads the counters through `window.__perf`.
import React, { Profiler, ProfilerOnRenderCallback, ReactNode } from "react";

/** Minimal store surface the census needs; the real Redux store satisfies it. */
export interface CensusStore {
  subscribe: (listener: () => void) => () => void;
  getState: () => unknown;
}

export interface PerfSnapshot {
  /** React commits of the app tree, any phase. */
  commits: number;
  mountCommits: number;
  updateCommits: number;
  /** Sum and worst of Profiler actualDuration. Wall-clock: report, never gate. */
  commitMs: number;
  maxCommitMs: number;
  /** Store notifications; Redux notifies subscribers once per dispatched action. */
  dispatches: number;
  /** MutationObserver records under document.body, and what they changed. */
  mutationRecords: number;
  addedNodes: number;
  removedNodes: number;
  attributeMutations: number;
  textMutations: number;
  /** Game clock at snapshot time, for placing windows against month boundaries. */
  game?: { minute: number; monthsElapsed: number; speed: string };
}

export interface PerfApi {
  reset: () => void;
  snapshot: () => PerfSnapshot;
}

declare global {
  interface Window {
    __perf?: PerfApi;
  }
}

/** Elements under this attribute (the B6 overlay) are excluded from the mutation census. */
export const PERF_IGNORE_ATTRIBUTE = "data-perf-ignore";

function emptyCounts() {
  return {
    commits: 0,
    mountCommits: 0,
    updateCommits: 0,
    commitMs: 0,
    maxCommitMs: 0,
    dispatches: 0,
    mutationRecords: 0,
    addedNodes: 0,
    removedNodes: 0,
    attributeMutations: 0,
    textMutations: 0,
  };
}

function isIgnored(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest(`[${PERF_IGNORE_ATTRIBUTE}]`));
}

function gameClock(state: unknown): PerfSnapshot["game"] {
  const game = (state as { game?: Record<string, unknown> } | undefined)?.game;
  const date = game?.date as
    { minute?: number; monthsElapsed?: number } | undefined;
  if (!game || !date) {
    return undefined;
  }
  return {
    minute: Number(date.minute),
    monthsElapsed: Number(date.monthsElapsed),
    speed: String(game.speed),
  };
}

export interface PerfCensus extends PerfApi {
  /** Wrap the app element in the census Profiler. */
  wrap: (app: ReactNode) => React.ReactElement;
  dispose: () => void;
}

/** Starts counting and returns the census; `installPerfCensus` also publishes it on window. */
export function createPerfCensus(
  store: CensusStore,
  root: Node = document.body,
): PerfCensus {
  let counts = emptyCounts();

  const record = (mutations: MutationRecord[]) => {
    for (const mutation of mutations) {
      if (isIgnored(mutation.target)) {
        continue;
      }
      counts.mutationRecords++;
      if (mutation.type === "childList") {
        counts.addedNodes += mutation.addedNodes.length;
        counts.removedNodes += mutation.removedNodes.length;
      } else if (mutation.type === "attributes") {
        counts.attributeMutations++;
      } else {
        counts.textMutations++;
      }
    }
  };
  const observer = new MutationObserver(record);
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const unsubscribe = store.subscribe(() => {
    counts.dispatches++;
  });

  const onRender: ProfilerOnRenderCallback = (_id, phase, actualDuration) => {
    counts.commits++;
    if (phase === "mount") {
      counts.mountCommits++;
    } else {
      counts.updateCommits++;
    }
    counts.commitMs += actualDuration;
    counts.maxCommitMs = Math.max(counts.maxCommitMs, actualDuration);
  };

  return {
    wrap: (app) => (
      <Profiler id="app" onRender={onRender}>
        {app}
      </Profiler>
    ),
    reset: () => {
      // Drop anything already queued so it lands in neither window
      observer.takeRecords();
      counts = emptyCounts();
    },
    snapshot: () => {
      // Mutation callbacks run as microtasks; include records not yet delivered
      record(observer.takeRecords());
      return { ...counts, game: gameClock(store.getState()) };
    },
    dispose: () => {
      observer.disconnect();
      unsubscribe();
    },
  };
}

export function installPerfCensus(
  store: CensusStore,
  app: ReactNode,
): React.ReactElement {
  const census = createPerfCensus(store);
  window.__perf = { reset: census.reset, snapshot: census.snapshot };
  return census.wrap(app);
}
