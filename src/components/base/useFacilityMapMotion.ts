import * as React from "react";
import type { SpeedType } from "../../Types";

export const FACILITY_MAP_PLAYBACK_RATE: Record<SpeedType, number> = {
  PAUSED: 0.25,
  SLOW: 0.7,
  NORMAL: 1,
  FAST: 1.2,
  ULTRA: 1.5,
};

/** One preference/visibility subscription for the whole map, never one per plant. */
export default function useFacilityMapMotion(
  speed: SpeedType = "PAUSED",
  covered = false,
) {
  const [reduced] = React.useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)"),
  );
  const [allowed, setAllowed] = React.useState(
    () => !document.hidden && !reduced.matches,
  );
  React.useEffect(() => {
    const refresh = () => setAllowed(!document.hidden && !reduced.matches);
    reduced.addEventListener("change", refresh);
    document.addEventListener("visibilitychange", refresh);
    refresh();
    return () => {
      reduced.removeEventListener("change", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reduced]);
  return React.useMemo(
    () => ({
      allowed: allowed && !covered,
      rate: FACILITY_MAP_PLAYBACK_RATE[speed],
    }),
    [allowed, covered, speed],
  );
}

export function useMapAnimationPlayback<T extends Element>(
  moving: boolean,
  rate: number,
  variant: string | number,
) {
  const ref = React.useRef<T>(null);
  React.useLayoutEffect(() => {
    for (const animation of ref.current?.getAnimations?.({ subtree: true }) ??
      []) {
      if ("transitionProperty" in animation) continue;
      if (animation.playbackRate !== rate) animation.updatePlaybackRate(rate);
      if (moving) {
        if (animation.playState !== "running") animation.play();
      } else if (animation.playState !== "paused") animation.pause();
    }
  }, [moving, rate, variant]);
  return ref;
}
