import * as React from "react";

/** One request for a worker. `undefined` in its place means there is nothing to ask. */
export interface WorkerJob<Req, Res> {
  /** Identifies the request: a new key, or a new scope, starts a new one after the debounce. */
  key: string;
  /** Compared by identity alongside the key, for inputs a string key can't capture cheaply. */
  scope?: unknown;
  /** Builds the message. With a reused worker the reply must echo `requestId`. */
  message: (requestId: number) => Req;
  /** Works the result out on the page when the worker fails. Without it, a failure is an error. */
  fallback?: () => Res;
}

export interface WorkerRequestOptions<Reply, Res> {
  createWorker: () => Worker;
  debounceMs: number;
  /**
   * Keep one worker across requests instead of starting one per request. Replies are matched to
   * the latest request by the `requestId` they echo, and the worker ends with the component.
   */
  reuseWorker?: boolean;
  /** Reads a reply: its result, or undefined when the worker reports a failure. */
  read: (data: Reply) => { result: Res } | undefined;
}

export type WorkerRequestState<Res> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: Res }
  // "startup": the worker could not be created or sent the request. "failed": it (and any
  // fallback) could not produce a result.
  | { status: "error"; reason: "startup" | "failed" };

const IDLE = { status: "idle" } as const;
const LOADING = { status: "loading" } as const;

/**
 * Runs a debounced request in a web worker and reports its state. A result only counts for the
 * key and scope it answers, so a stale reply can never be read as the current one; an unhandled
 * worker error is handled here rather than re-raised on the window.
 */
export function useWorkerRequest<Req, Reply, Res>(
  job: WorkerJob<Req, Res> | undefined,
  options: WorkerRequestOptions<Reply, Res>,
): WorkerRequestState<Res> {
  const [settled, setSettled] = React.useState<{
    key: string;
    scope: unknown;
    state: WorkerRequestState<Res>;
  }>();
  const latestJob = React.useRef(job);
  latestJob.current = job;
  const latestOptions = React.useRef(options);
  latestOptions.current = options;
  const requestId = React.useRef(0);
  const shared = React.useRef<Worker>();
  const key = job?.key;
  const scope = job?.scope;

  React.useEffect(
    () => () => {
      shared.current?.terminate();
      shared.current = undefined;
    },
    [],
  );

  React.useEffect(() => {
    const id = ++requestId.current;
    const current = latestJob.current;
    if (key === undefined || !current) return;
    const { createWorker, debounceMs, reuseWorker, read } =
      latestOptions.current;
    let worker: Worker | undefined;
    let cancelled = false;
    const settle = (state: WorkerRequestState<Res>) => {
      if (!cancelled && id === requestId.current) {
        setSettled({ key, scope, state });
      }
    };
    const failed = () => {
      if (!current.fallback) {
        settle({ status: "error", reason: "failed" });
        return;
      }
      if (cancelled) return;
      try {
        settle({ status: "ready", result: current.fallback() });
      } catch (_error) {
        settle({ status: "error", reason: "failed" });
      }
    };
    const timer = window.setTimeout(() => {
      try {
        if (reuseWorker) {
          shared.current = shared.current ?? createWorker();
          worker = shared.current;
        } else {
          worker = createWorker();
        }
        worker.onmessage = (event: MessageEvent<Reply>) => {
          if (
            reuseWorker &&
            (event.data as { requestId?: number } | undefined)?.requestId !== id
          ) {
            return;
          }
          const reply = read(event.data);
          if (reply) settle({ status: "ready", result: reply.result });
          else failed();
        };
        worker.onerror = (event: ErrorEvent) => {
          // An unhandled worker error is re-raised on the window. It is handled here, so it must
          // not also be reported as an uncaught runtime error.
          event.preventDefault();
          // A failed script may leave a Worker object that accepts messages but never
          // replies. Retire it so the next request can create a working replacement.
          if (shared.current === worker) shared.current = undefined;
          if (worker) {
            worker.onmessage = null;
            worker.onerror = null;
            worker.terminate();
          }
          failed();
        };
        worker.postMessage(current.message(id));
      } catch (_error) {
        // Startup and structured-clone failures happen synchronously, outside onerror.
        if (reuseWorker && shared.current) {
          const broken = shared.current;
          shared.current = undefined;
          broken.onmessage = null;
          broken.onerror = null;
          broken.terminate();
        }
        settle({ status: "error", reason: "startup" });
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (!reuseWorker) worker?.terminate();
    };
  }, [key, scope]);

  if (key === undefined) return IDLE;
  if (settled && settled.key === key && settled.scope === scope) {
    return settled.state;
  }
  return LOADING;
}
