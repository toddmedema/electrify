import type { AppStore } from "../Store";
import type { DesktopBridge } from "../Desktop";

/** Reducer telemetry is already earned evidence; restores only retry its durable intent. */
export function startAchievements(
  store: Pick<AppStore, "getState" | "subscribe">,
  desktop: DesktopBridge,
): () => void {
  let stopped = false;
  let sent = "";
  const publish = () => {
    const { game, saves } = store.getState();
    const progress = game.desktopAchievements;
    if (
      stopped ||
      saves.transitioning ||
      game.customScenario ||
      !progress ||
      !desktop.submitAchievements
    )
      return;
    const intent = {
      earned: [...progress.earned],
      completion: progress.completion,
    };
    const key = JSON.stringify(intent);
    if (key === sent || (!intent.earned.length && !intent.completion)) return;
    sent = key;
    void desktop.submitAchievements(intent).catch(() => {
      if (sent === key) sent = "";
    });
  };
  publish();
  const unsubscribe = store.subscribe(publish);
  const retry = setInterval(publish, 5000);
  return () => {
    stopped = true;
    clearInterval(retry);
    unsubscribe();
  };
}
