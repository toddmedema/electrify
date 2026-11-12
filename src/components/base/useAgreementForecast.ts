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
  }>();
  const latest = React.useRef({ game, agreementId, offer });
  latest.current = { game, agreementId, offer };
  const cache = React.useRef(new Map<string, AgreementForecast>());
  React.useEffect(() => {
    const id = ++requestId.current;
    if (!key) return;
    const cached = cache.current.get(key);
    if (cached) {
      setState({ key, result: cached });
      return;
    }
    setState({ key });
    const fail = () => {
      if (requestId.current === id) setState({ key, error: true });
      worker.current?.terminate();
      worker.current = undefined;
    };
    try {
      const active = (worker.current ??= createProjectionWorker());
      active.onmessage = (event: MessageEvent<AgreementForecastReply>) => {
        if (
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
  }, [key, retry, epoch]);
  React.useEffect(() => () => worker.current?.terminate(), []);
  return {
    blocked,
    result: state?.key === key ? state?.result : undefined,
    error: state?.key === key && state?.error,
    updating: !!state?.result || (!!state && state.key !== key),
    retry: retryForecast,
  };
}
