import * as React from "react";
import type { GameType, PowerAgreementReceipt } from "../../Types";
import {
  agreementForecastKey,
  AgreementForecast,
  AgreementForecastReply,
} from "../../helpers/AgreementForecast";
import { createProjectionWorker } from "./ProjectionWorkerClient";
import { forecastWorkerSnapshot } from "./ForecastWorkerSnapshot";

let nextSession = 0;
export function useAgreementForecast(
  game: GameType,
  agreementId?: string,
  offer?: PowerAgreementReceipt,
  committed = true,
) {
  const worker = React.useRef<Worker>();
  const requestId = React.useRef(0);
  const [sessionId] = React.useState(() => ++nextSession);
  const session = React.useRef({
    id: sessionId,
    history: game.monthlyHistory,
    revision: 0,
  });
  if (session.current.history !== game.monthlyHistory) {
    session.current.history = game.monthlyHistory;
    session.current.revision++;
  }
  const epoch = `${session.current.id}:${session.current.revision}`;
  const blocked = game.multiplayer
    ? "coop"
    : game.transmission?.buyingRule === "NONE"
      ? "buying"
      : undefined;
  const key =
    agreementId && !blocked
      ? `${epoch}|${agreementForecastKey(game, agreementId, offer)}`
      : undefined;
  const [retry, retryForecast] = React.useReducer(
    (value: number) => value + 1,
    0,
  );
  const [state, setState] = React.useState<{
    key?: string;
    result?: AgreementForecast;
    error?: boolean;
    updating?: boolean;
  }>();
  const latest = React.useRef({ game, agreementId, offer });
  latest.current = { game, agreementId, offer };
  const cache = React.useRef(new Map<string, AgreementForecast>());
  React.useEffect(() => {
    const id = ++requestId.current;
    if (!key) {
      setState(undefined);
      return;
    }
    if (!committed) return;
    const cached = cache.current.get(key);
    if (cached) {
      setState({ key, result: cached });
      return;
    }
    setState((previous) => ({ key, updating: !!previous?.key }));
    let active: Worker | undefined;
    let cancelled = false;
    const stop = () => {
      if (!active) return;
      const stopped = active;
      active = undefined;
      stopped.onmessage = null;
      stopped.onerror = null;
      stopped.onmessageerror = null;
      stopped.terminate();
      if (worker.current === stopped) worker.current = undefined;
    };
    const fail = () => {
      if (cancelled || requestId.current !== id) return;
      setState({ key, error: true });
      stop();
    };
    try {
      active = createProjectionWorker();
      worker.current = active;
      active.onmessage = (event: MessageEvent<AgreementForecastReply>) => {
        if (
          cancelled ||
          event.data.requestId !== requestId.current ||
          event.data.requestId !== id
        )
          return;
        if (event.data.error || !event.data.agreementForecast) {
          fail();
          return;
        }
        cache.current.set(key, event.data.agreementForecast);
        if (cache.current.size > 6)
          cache.current.delete(cache.current.keys().next().value!);
        setState({ key, result: event.data.agreementForecast });
      };
      active.onerror = fail;
      active.onmessageerror = fail;
      active.postMessage({
        kind: "agreement",
        requestId: id,
        cacheEpoch: epoch,
        ...latest.current,
        game: forecastWorkerSnapshot(latest.current.game),
      });
    } catch (_error) {
      fail();
    }
    // Each new key cancels the previous computation rather than queuing more work.
    return () => {
      cancelled = true;
      stop();
    };
  }, [key, retry, epoch, committed]);
  return {
    blocked,
    result: committed && state?.key === key ? state?.result : undefined,
    error: committed && state?.key === key && state?.error,
    updating:
      !committed || (state?.key === key ? !!state?.updating : !!state?.key),
    retry: retryForecast,
  };
}
