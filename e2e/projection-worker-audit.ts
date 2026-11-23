import type { ProjectionTransport } from "../src/components/base/ProjectionTransport";
import type { ProjectionScope } from "../src/helpers/Projection";

type WorkerRequest = {
  workerId: number;
  requestId: number;
  scope: ProjectionScope;
  monthsElapsed: number;
  rate: number;
};

export interface DesktopWorkerAudit {
  workers: string[];
  requests: WorkerRequest[];
  messages: { workerId: number; requestId?: number; keys: string[] }[];
  replies: {
    workerId: number;
    requestId: number;
    numericBytes: number;
    cashMonths: number;
    forecastTicks: number;
  }[];
  errors: {
    workerId: number;
    kind: "reply" | "error" | "messageerror";
    requestId?: number;
    message?: string;
    filename?: string;
  }[];
}

/** Installed in the renderer before the game creates its first worker. */
export function installDesktopWorkerAudit(): void {
  const state: DesktopWorkerAudit = {
    workers: [],
    requests: [],
    messages: [],
    replies: [],
    errors: [],
  };
  Object.assign(window, { desktopWorkerAudit: state });
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    private readonly workerId: number;

    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      const workerId = state.workers.length;
      this.workerId = workerId;
      state.workers.push(new URL(String(url), document.baseURI).href);
      this.addEventListener(
        "message",
        ({
          data,
        }: MessageEvent<{
          requestId: number;
          transport?: ProjectionTransport;
          error?: boolean;
        }>) => {
          state.messages.push({
            workerId,
            requestId: data?.requestId,
            keys: data && typeof data === "object" ? Object.keys(data) : [],
          });
          if (data?.error) {
            state.errors.push({
              workerId,
              kind: "reply",
              requestId: data.requestId,
            });
          }
          if (data?.transport) {
            state.replies.push({
              workerId,
              requestId: data.requestId,
              numericBytes: data.transport.ticks.numbers.values.byteLength,
              cashMonths: data.transport.cashMonths,
              forecastTicks: data.transport.ticks.numbers.count,
            });
          }
        },
      );
      this.addEventListener("error", (event) => {
        state.errors.push({
          workerId,
          kind: "error",
          message: event.message,
          filename: event.filename,
        });
      });
      this.addEventListener("messageerror", () => {
        state.errors.push({ workerId, kind: "messageerror" });
      });
    }

    postMessage(message: unknown) {
      if (
        message &&
        typeof message === "object" &&
        "game" in message &&
        "now" in message &&
        "scope" in message &&
        (message.scope === "planning" || message.scope === "top-bar") &&
        "requestId" in message &&
        typeof message.requestId === "number"
      ) {
        const game = message.game as {
          date: { monthsElapsed: number };
          dollarsPerkWh: number;
        };
        state.requests.push({
          workerId: this.workerId,
          requestId: message.requestId,
          scope: message.scope,
          monthsElapsed: game.date.monthsElapsed,
          rate: game.dollarsPerkWh,
        });
      }
      super.postMessage(message);
    }
  };
}

export function planningProjectionStatus(
  audit: DesktopWorkerAudit,
  firstRequest: number,
  rate: number,
): { requested: boolean; completed: boolean } {
  const request = audit.requests
    .slice(firstRequest)
    .find(
      (entry) =>
        entry.scope === "planning" && Math.abs(entry.rate - rate) < 1e-10,
    );
  return {
    requested: request !== undefined,
    completed:
      request !== undefined &&
      audit.replies.some(
        (reply) =>
          reply.workerId === request.workerId &&
          reply.requestId === request.requestId,
      ),
  };
}
