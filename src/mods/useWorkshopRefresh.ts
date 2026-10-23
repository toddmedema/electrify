import { useCallback, useEffect, useRef, useState } from "react";
import { getDesktop } from "../Desktop";
import type { ModLibrary } from "./Types";

/** One screen-owned download loop. A focus return and repeated clicks share its in-flight request. */
export function useWorkshopRefresh(
  enabled: boolean,
  refresh: () => Promise<ModLibrary | undefined>,
  canRefresh: () => boolean,
) {
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const online = () => setNetworkOnline(true);
    const offline = () => setNetworkOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);
  const available = enabled && networkOnline;
  const startRef = useRef<() => void>(() => {});
  const [timedOut, setTimedOut] = useState(false);
  const check = useCallback(() => startRef.current(), []);
  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    let running = false;
    let inFlight = false;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      running = false;
      clearTimeout(timer);
      clearTimeout(deadline);
    };
    const tick = async () => {
      clearTimeout(timer);
      if (cancelled || !running || inFlight) return;
      if (!canRefresh()) {
        timer = setTimeout(tick, 1000);
        return;
      }
      inFlight = true;
      let result: ModLibrary | undefined;
      try {
        result = await refresh();
      } catch {
        stop();
      } finally {
        inFlight = false;
      }
      if (cancelled || !running) return;
      if (result?.downloads?.some((item) => item.status !== "skipped")) {
        timer = setTimeout(tick, delay);
        delay = Math.min(5000, delay * 2);
      } else stop();
    };
    const start = () => {
      if (cancelled) return;
      if (!running) {
        running = true;
        delay = 1000;
        setTimedOut(false);
        deadline = setTimeout(() => {
          stop();
          if (!cancelled) setTimedOut(true);
        }, 120000);
      }
      void tick();
    };
    startRef.current = start;
    start();
    let lostFocus = false;
    const focus = (focused: boolean) => {
      if (!focused) lostFocus = true;
      else if (lostFocus) {
        lostFocus = false;
        start();
      }
    };
    const blur = () => focus(false);
    const regain = () => focus(true);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", regain);
    const unsubscribe = getDesktop()?.onGameFocusChanged?.(focus);
    return () => {
      cancelled = true;
      stop();
      startRef.current = () => {};
      unsubscribe?.();
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", regain);
    };
  }, [available, refresh, canRefresh]);
  return { check, timedOut, available };
}
